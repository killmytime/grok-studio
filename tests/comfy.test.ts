/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'http';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { vi } from 'vitest';
import { DEFAULT_NEGATIVE, prepareEditWorkflow, prepareGenerateWorkflow, prepareRedrawWorkflow } from '../app/lib/providers/comfy/workflow';

const TEST_DATA_DIR = join(process.cwd(), 'tests', '.tmp-comfy');
process.env.DATA_DIR = TEST_DATA_DIR;
if (existsSync(TEST_DATA_DIR)) rmSync(TEST_DATA_DIR, { recursive: true, force: true });
mkdirSync(TEST_DATA_DIR, { recursive: true });

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

type Hit = { method: string; url: string; body: any; raw: string };

function startComfy() {
  const hits: Hit[] = [];
  let seq = 0;
  let interrupts = 0;
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    let body: any = {};
    const type = String(req.headers['content-type'] || '');
    if (type.includes('application/json') && raw) {
      try { body = JSON.parse(raw); } catch { body = { raw }; }
    }
    const url = req.url || '';
    hits.push({ method: req.method || '', url, body, raw });

    if (req.method === 'GET' && url.startsWith('/system_stats')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ system: { os: 'test' } }));
      return;
    }
    if (req.method === 'GET' && url.startsWith('/models/unet')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(['qwen_image_2.1_int8_convrot.safetensors']));
      return;
    }
    if (req.method === 'POST' && url.startsWith('/upload/image')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ name: 'uploaded.png', subfolder: '', type: 'input' }));
      return;
    }
    if (req.method === 'POST' && url.startsWith('/prompt')) {
      const id = `p${++seq}`;
      const graph = body.prompt || {};
      const latent = Object.values(graph).find((node: any) => node?.class_type === 'EmptySD3LatentImage') as any;
      const count = Math.max(1, Number(latent?.inputs?.batch_size) || 1);
      const images = Array.from({ length: count }, (_, i) => ({
        filename: `ComfyUI_${id}_${i}.png`,
        subfolder: '',
        type: 'output',
      }));
      (server as any).history[id] = {
        outputs: { '9': { images } },
        status: { completed: true, status_str: 'success' },
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ prompt_id: id, number: seq, node_errors: {} }));
      return;
    }
    if (req.method === 'GET' && url.startsWith('/history/')) {
      const id = decodeURIComponent(url.slice('/history/'.length));
      const entry = (server as any).history[id];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(entry ? { [id]: entry } : {}));
      return;
    }
    if (req.method === 'GET' && url.startsWith('/view')) {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(TINY_PNG);
      return;
    }
    if (req.method === 'POST' && url.startsWith('/queue')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ deleted: body.delete || [] }));
      return;
    }
    if (req.method === 'GET' && url.startsWith('/queue')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ queue_running: [[0, 'running-other']], queue_pending: [] }));
      return;
    }
    if (req.method === 'POST' && url.startsWith('/interrupt')) {
      interrupts += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found', url }));
  });
  (server as any).history = {} as Record<string, any>;
  return new Promise<{ server: Server; url: string; hits: Hit[]; interrupts: () => number }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        server,
        url: `http://127.0.0.1:${port}`,
        hits,
        interrupts: () => interrupts,
      });
    });
  });
}

async function untilDone(getImage: (id: string) => any, ids: string[]) {
  for (let i = 0; i < 50; i++) {
    const rows = ids.map((id) => getImage(id));
    if (rows.every((row) => row && row.status !== 'pending')) return rows;
    await new Promise((r) => setTimeout(r, 20));
  }
  return ids.map((id) => getImage(id));
}

describe('comfyui qwen image 2.1', () => {
  let db: any;
  let vendors: any;
  let generateImages: (opts: any) => Promise<any>;
  let editImages: (opts: any) => Promise<any>;
  let saveImageFromBase64: (b64: string, conv: string, prompt: string, model: string, aspect: string, resolution: string) => Promise<any>;
  let listRemoteModels: (opts: any) => Promise<any>;
  let comfyHealth: (url: string, key: string) => Promise<any>;
  let cancelQueuedPrompt: (url: string, key: string, id: string) => Promise<void>;
  let catalog: any;
  let server: Awaited<ReturnType<typeof startComfy>>;

  beforeAll(async () => {
    vi.resetModules();
    process.env.DATA_DIR = TEST_DATA_DIR;
    db = await import('../app/lib/db');
    vendors = await import('../app/lib/vendors');
    const gen = await import('../app/lib/providers/image-generate');
    const edit = await import('../app/lib/providers/image-edit');
    const image = await import('../app/lib/image');
    const models = await import('../app/lib/providers/list-models');
    const client = await import('../app/lib/providers/comfy/client');
    catalog = await import('../app/lib/integrations/catalog');
    generateImages = gen.generateImages;
    editImages = edit.editImages;
    saveImageFromBase64 = image.saveImageFromBase64;
    listRemoteModels = models.listRemoteModels;
    comfyHealth = client.comfyHealth;
    cancelQueuedPrompt = client.cancelQueuedPrompt;
    server = await startComfy();
    const vendor = vendors.upsertVendor({
      kind: 'comfyui',
      label: 'Qwen',
      base_url: server.url,
      extra: { seed: '11', steps: '8' },
      models: [{ model: 'qwen-image-2.1', capabilities: ['image.generate', 'image.edit'] }],
    });
    vendors.setBinding('image.generate', vendor.id, 'qwen-image-2.1');
    vendors.setBinding('image.edit', vendor.id, 'qwen-image-2.1');
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.server.close(() => resolve()));
    if (existsSync(TEST_DATA_DIR)) {
      try { rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it('keeps the tested generate graph and only fills the positive prompt by default', () => {
    const prepared = prepareGenerateWorkflow({
      positive: 'a red fox',
      width: 1024,
      height: 576,
      batch: 2,
      seed: 99,
    });
    const positive = prepared.graph['67'];
    const negative = prepared.graph['71'];
    const latent = prepared.graph['68'];
    const sampler = prepared.graph['70'];
    expect(positive.inputs.text).toBe('a red fox');
    expect(negative.inputs.text).toBe(DEFAULT_NEGATIVE);
    expect(prepared.negative).toBe(DEFAULT_NEGATIVE);
    expect(latent.inputs).toMatchObject({ width: 1024, height: 576, batch_size: 2 });
    expect(sampler.inputs.seed).toBe(99);
    expect(sampler.inputs.steps).toBe(20);
    expect(sampler.inputs.cfg).toBe(1);
    expect(prepared.graph['66'].inputs.unet_name).toBe('qwen_image_2.1_int8_convrot.safetensors');
    expect(prepared.graph['69'].inputs).toMatchObject({ shift: 3, sampling: 'flow' });
  });

  it('replaces the negative prompt only when one is given', () => {
    const prepared = prepareGenerateWorkflow({
      positive: 'a red fox',
      negative: 'blurry hands',
      width: 512,
      height: 512,
      batch: 1,
      steps: 6,
    });
    expect(prepared.graph['67'].inputs.text).toBe('a red fox');
    expect(prepared.graph['71'].inputs.text).toBe('blurry hands');
    expect(prepared.graph['70'].inputs.steps).toBe(6);
  });

  it('edit graph keeps the same weights and feeds the reference image into Qwen Image 2.1', () => {
    const prepared = prepareEditWorkflow({
      positive: 'make the coat red',
      imageName: 'uploaded.png',
      resolution: 1024,
      seed: 3,
    });
    expect(prepared.graph['80'].inputs.image).toBe('uploaded.png');
    expect(prepared.graph['81'].inputs.prompt).toBe('make the coat red');
    expect(prepared.graph['81'].inputs.negative_prompt).toBe(DEFAULT_NEGATIVE);
    expect(prepared.graph['81'].inputs.resolution).toBe(1024);
    expect(prepared.graph['81'].inputs['images.image_1']).toEqual(['80', 0]);
    expect(prepared.graph['70'].inputs.denoise).toBe(1);
    expect(prepared.graph['70'].inputs.latent_image).toEqual(['81', 2]);
    expect(prepared.graph['70'].inputs.positive).toEqual(['81', 0]);
    expect(prepared.graph['70'].inputs.negative).toEqual(['81', 1]);
    expect(prepared.graph['66'].inputs.unet_name).toBe('qwen_image_2.1_int8_convrot.safetensors');
  });

  it('redraw keeps the source pixels and opens room for new clothes or objects', () => {
    const prepared = prepareRedrawWorkflow({
      positive: 'a red coat',
      imageName: 'uploaded.png',
      denoise: 0.85,
      seed: 3,
    });
    expect(prepared.graph['80'].inputs.image).toBe('uploaded.png');
    expect(prepared.graph['82'].class_type).toBe('VAEEncode');
    expect(prepared.graph['82'].inputs.vae).toEqual(['63', 0]);
    expect(prepared.graph['70'].inputs.latent_image).toEqual(['82', 0]);
    expect(prepared.graph['70'].inputs.denoise).toBe(0.85);
    expect(prepared.graph['67'].inputs.text).toBe('a red coat');
    expect(prepared.graph['70'].inputs.steps).toBe(20);
  });

  it('does not bake the production LAN address into the client', () => {
    const src = readFileSync(join(process.cwd(), 'app/lib/providers/comfy/client.ts'), 'utf8');
    const run = readFileSync(join(process.cwd(), 'app/lib/providers/comfy/run.ts'), 'utf8');
    expect(src).not.toContain('192.168.1.29');
    expect(run).not.toContain('192.168.1.29');
    expect(catalog.hasCapability('comfyui', 'image.generate')).toBe(true);
    expect(catalog.hasCapability('comfyui', 'image.edit')).toBe(true);
    expect(catalog.canonicalIntegrationId('comfy')).toBe('comfyui');
  });

  it('submits the tested graph, polls history, and stores the png', async () => {
    const conv = db.createConversation('comfy');
    const result = await generateImages({
      prompt: 'a small fox',
      conversation_id: conv.id,
      aspect_ratio: '16:9',
      resolution: '1k',
      n: 2,
    });
    expect(result.images).toHaveLength(2);
    expect(result.images[0].status).toBe('pending');
    const promptHit = server.hits.find((hit) => hit.url.startsWith('/prompt'));
    expect(promptHit?.body.client_id).toBe('grok-studio');
    expect(promptHit?.body.prompt['67'].inputs.text).toBe('a small fox');
    expect(promptHit?.body.prompt['71'].inputs.text).toBe(DEFAULT_NEGATIVE);
    expect(promptHit?.body.prompt['68'].inputs).toMatchObject({ width: 1024, height: 576, batch_size: 2 });
    expect(promptHit?.body.prompt['70'].inputs.seed).toBe(11);
    expect(server.hits.every((hit) => !String(hit.url).includes('192.168.1.29'))).toBe(true);

    const done = await untilDone(db.getImage, result.images.map((img: any) => img.id));
    expect(done.map((img) => img.status)).toEqual(['completed', 'completed']);
    expect(done[0].file_path).toMatch(/^images\//);
    expect(done[0].negative_prompt).toBe(DEFAULT_NEGATIVE);
    expect(done[0].extra_json.provider).toBe('comfyui');
    expect(done[0].extra_json.seed).toBe(11);
    expect(done[1].n_index).toBe(2);
  });

  it('uploads the source image and redraws it at the recommended denoise', async () => {
    const conv = db.createConversation('comfy-edit');
    const source = await saveImageFromBase64(TINY_PNG.toString('base64'), conv.id, 'orig', 'qwen-image-2.1', '1:1', '1k');
    const result = await editImages({
      prompt: 'make the coat red',
      image_id: source.id,
      conversation_id: conv.id,
      resolution: '1k',
      negative_prompt: 'extra fingers',
    });
    expect(result.images[0].status).toBe('pending');
    expect(result.images[0].kind).toBe('edit');
    const promptHits = server.hits.filter((hit) => hit.url.startsWith('/prompt'));
    const editHit = promptHits[promptHits.length - 1];
    const upload = server.hits.find((hit) => hit.url.startsWith('/upload/image'));
    expect(upload?.raw).toContain('filename=');
    expect(editHit.body.prompt['80'].inputs.image).toBe('uploaded.png');
    expect(editHit.body.prompt['82'].class_type).toBe('VAEEncode');
    expect(editHit.body.prompt['67'].inputs.text).toBe('make the coat red');
    expect(editHit.body.prompt['71'].inputs.text).toBe('extra fingers');
    expect(editHit.body.prompt['70'].inputs.denoise).toBe(0.85);
    expect(editHit.body.prompt['70'].inputs.latent_image).toEqual(['82', 0]);
    const done = await untilDone(db.getImage, [result.images[0].id]);
    expect(done[0].status).toBe('completed');
    expect(done[0].parent_image_id).toBe(source.id);
  });

  it('probes system_stats and lists unets without calling the LAN host', async () => {
    const health = await comfyHealth(server.url, '');
    expect(health.ok).toBe(true);
    const listed = await listRemoteModels({ kind: 'comfyui', baseUrl: `${server.url}/v1` });
    expect(listed.endpoint).toBe(`${server.url}/models/unet`);
    expect(listed.models[0].id).toBe('qwen_image_2.1_int8_convrot.safetensors');
    expect(listed.models[0].suggested).toEqual(['image.generate', 'image.edit']);
    await cancelQueuedPrompt(server.url, '', 'not-running');
    expect(server.interrupts()).toBe(0);
    const queuePost = server.hits.filter((hit) => hit.method === 'POST' && hit.url.startsWith('/queue'));
    expect(queuePost.some((hit) => hit.body?.delete?.[0] === 'not-running')).toBe(true);
  });
});
