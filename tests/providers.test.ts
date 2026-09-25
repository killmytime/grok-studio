/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, type Server } from 'http';
import { join } from 'path';
import { rmSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { vi } from 'vitest';

const TEST_DATA_DIR = join(process.cwd(), 'tests', '.tmp-providers');
process.env.DATA_DIR = TEST_DATA_DIR;
if (existsSync(TEST_DATA_DIR)) rmSync(TEST_DATA_DIR, { recursive: true, force: true });
mkdirSync(TEST_DATA_DIR, { recursive: true });

const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

type Captured = { method?: string; url: string; authorization: string; body: any };

const upstreamState: { responses: 'missing' | 'image' } = { responses: 'missing' };

function startFakeOpenAI() {
  const requests: Captured[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    let body: any = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      body = { raw };
    }
    const rec: Captured = {
      method: req.method,
      url: req.url || '',
      authorization: String(req.headers.authorization || ''),
      body,
    };
    requests.push(rec);

    if (req.method === 'GET' && (req.url || '').includes('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'sd-cpp-local', object: 'model' }] }));
      return;
    }

    if ((req.url || '').includes('/responses')) {
      if (upstreamState.responses === 'image') {
        const item = {
          type: 'image_generation_call',
          id: 'ig_test_call',
          status: 'completed',
          prompt: 'a red silk shirt, woodblock',
          aspect_ratio: '16:9',
          result: TINY_PNG,
        };
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: '画好了' })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'response.output_item.done', item })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'response.completed', response: { id: 'resp_test', output: [item] } })}\n\n`);
        res.end();
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found', url: req.url }));
      return;
    }

    if ((req.url || '').includes('/chat/completions')) {
      if (body.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write('data: {"choices":[{"delta":{"content":"hello from chat"}}]}\n\n');
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'summary-or-health-ok' } }] }));
      return;
    }
    if ((req.url || '').includes('/images/generations') || (req.url || '').includes('/images/edits')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ b64_json: TINY_PNG }] }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found', url: req.url }));
  });

  return new Promise<{ server: Server; port: number; baseUrl: string; requests: Captured[] }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, port, baseUrl: `http://127.0.0.1:${port}/v1`, requests });
    });
  });
}

async function drainStream(res: Response) {
  if (!res.body) return await res.text();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

describe('capability providers (shipped routes)', () => {
  let db: any;
  let chatRoute: any;
  let generateRoute: any;
  let editRoute: any;
  let healthRoute: any;
  let summarizeRoute: any;
  let imageIdRoute: any;
  let settingsRoute: any;
  let backends: any;
  let chatUp: Awaited<ReturnType<typeof startFakeOpenAI>>;
  let imageUp: Awaited<ReturnType<typeof startFakeOpenAI>>;
  let gateway: { server: any; url: string; port: number };
  let convId: string;
  let setInferHook: any;
  let resetQueue: any;

  beforeAll(async () => {
    vi.resetModules();
    process.env.DATA_DIR = TEST_DATA_DIR;
    db = await import('../app/lib/db');
    chatRoute = await import('../app/api/chat/route');
    generateRoute = await import('../app/api/images/generate/route');
    editRoute = await import('../app/api/images/edit/route');
    healthRoute = await import('../app/api/health/route');
    summarizeRoute = await import('../app/api/conversations/[id]/summarize/route');
    imageIdRoute = await import('../app/api/images/[id]/route');
    settingsRoute = await import('../app/api/settings/route');
    backends = await import('../app/lib/backends');
    const gw = await import('../gateway/server.mjs');
    setInferHook = gw.setInferHook;
    resetQueue = gw.resetQueue;
    chatUp = await startFakeOpenAI();
    imageUp = await startFakeOpenAI();
    gateway = await gw.startGateway(0, '127.0.0.1');
    const conv = db.createConversation('provider-tests');
    convId = conv.id;
  });

  afterAll(async () => {
    chatUp?.server.close();
    imageUp?.server.close();
    gateway?.server.close();
    if (existsSync(TEST_DATA_DIR)) {
      try { rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch {}
    }
  });

  beforeEach(() => {
    upstreamState.responses = 'missing';
    chatUp.requests.length = 0;
    imageUp.requests.length = 0;
    resetQueue?.();
    db.setSetting('base_url', chatUp.baseUrl);
    db.setSetting('api_key', 'sk-shared');
    db.setSetting('chat_provider', 'grok');
    db.setSetting('chat_base_url', '');
    db.setSetting('chat_api_key', '');
    db.setSetting('image_generate_provider', 'grok');
    db.setSetting('image_generate_base_url', '');
    db.setSetting('image_generate_api_key', '');
    db.setSetting('image_edit_provider', 'grok');
    db.setSetting('image_edit_base_url', '');
    db.setSetting('image_edit_api_key', '');
    db.setSetting('jetson_gateway_url', gateway.url);
    db.setSetting('jetson_api_key', '');
    db.setSetting('chat_model', 'grok-latest');
    db.setSetting('image_model', 'grok-imagine-image-2.0');
  });

  it('settings UI has split chat vs image vs jetson controls', () => {
    const src = readFileSync(join(process.cwd(), 'app/components/SettingsDrawer.tsx'), 'utf8');
    expect(src).toContain('/api/vendors');
    expect(src).toContain('/api/vendors/models');
    expect(src).toContain('/v1/audio/voices');
    const pageSrc = readFileSync(join(process.cwd(), 'app/page.tsx'), 'utf8');
    expect(pageSrc).toContain('elapsed_ms');
    expect(pageSrc).toContain('种子');
    expect(src).toContain('/api/bindings');
    expect(src).toContain('STUDIO_PASSWORD');
    expect(src).toContain("test('chat')");
    const catalogSrc = readFileSync(join(process.cwd(), 'app/lib/integrations/catalog.ts'), 'utf8');
    expect(catalogSrc).toContain("'image.edit'");
    const bar = readFileSync(join(process.cwd(), 'app/components/ActiveBackendsBar.tsx'), 'utf8');
    expect(bar).toContain('聊天');
    expect(bar).toContain('生图');
    expect(bar).toContain('改图');
  });

  it('settings GET exposes split chat / generate / edit / jetson fields', async () => {
    const res = await settingsRoute.GET();
    const data = await res.json();
    expect(data).toHaveProperty('chat_provider');
    expect(data).toHaveProperty('chat_base_url');
    expect(data).toHaveProperty('image_generate_provider');
    expect(data).toHaveProperty('image_generate_base_url');
    expect(data).toHaveProperty('image_edit_base_url');
    expect(data).toHaveProperty('jetson_gateway_url');
    expect(data).toHaveProperty('resolved_chat_base_url');
    expect(data).toHaveProperty('resolved_image_edit_base_url');
    expect(data.active.chat.model).toBeTruthy();
    expect(data.active.generate.model).toBeTruthy();
    expect(data.active.edit).toHaveProperty('available');
    expect(data.active.chat.capabilities).toContain('chat');
  });

  it('integration catalog: grok can edit, imagen/jetson cannot; jetson aliases to imagen', async () => {
    const catalog = await import('../app/lib/integrations/catalog');
    expect(catalog.hasCapability('grok', 'image.edit')).toBe(true);
    expect(catalog.hasCapability('grok', 'image.generate')).toBe(true);
    expect(catalog.hasCapability('imagen', 'image.generate')).toBe(true);
    expect(catalog.hasCapability('imagen', 'image.edit')).toBe(false);
    expect(catalog.hasCapability('jetson', 'image.edit')).toBe(false);
    expect(catalog.canonicalIntegrationId('jetson')).toBe('imagen');
    expect(catalog.integrationsFor('image.edit').every((i: any) => i.capabilities.includes('image.edit'))).toBe(true);
    expect(catalog.integrationsFor('image.edit').some((i: any) => i.id === 'imagen')).toBe(false);

    db.setSetting('image_generate_provider', 'jetson');
    const active = backends.resolveActiveBackends();
    expect(active.generate.integration).toBe('imagen');
    expect(active.generate.supportsEdit).toBe(false);
    expect(active.edit.integration).toBe('grok');
    expect(active.chat.model).toBeTruthy();

    db.setSetting('image_edit_provider', 'imagen');
    const blocked = backends.resolveActiveBackends();
    expect(blocked.edit.available).toBe(false);
    expect(blocked.edit.reason).toMatch(/不支持改图/);
  });

  it('falls back to shared Grok base_url/api_key until independently overridden', () => {
    const chat = backends.resolveChatBackend();
    const gen = backends.resolveImageGenerateBackend();
    const edit = backends.resolveImageEditBackend();
    expect(chat.baseUrl).toBe(chatUp.baseUrl);
    expect(gen.baseUrl).toBe(chatUp.baseUrl);
    expect(edit.baseUrl).toBe(chatUp.baseUrl);
    expect(chat.apiKey).toBe('sk-shared');
    expect(gen.apiKey).toBe('sk-shared');
    expect(edit.apiKey).toBe('sk-shared');

    db.setSetting('chat_base_url', 'http://chat-only.example/v1');
    db.setSetting('chat_api_key', 'sk-chat');
    db.setSetting('image_generate_base_url', 'http://gen-only.example/v1');
    db.setSetting('image_generate_api_key', 'sk-gen');
    db.setSetting('image_edit_base_url', 'http://edit-only.example/v1');
    db.setSetting('image_edit_api_key', 'sk-edit');

    expect(backends.resolveChatBackend().baseUrl).toContain('chat-only');
    expect(backends.resolveChatBackend().apiKey).toBe('sk-chat');
    expect(backends.resolveImageGenerateBackend().baseUrl).toContain('gen-only');
    expect(backends.resolveImageGenerateBackend().apiKey).toBe('sk-gen');
    expect(backends.resolveImageEditBackend().baseUrl).toContain('edit-only');
    expect(backends.resolveImageEditBackend().apiKey).toBe('sk-edit');
    // changing generate does not silently change chat or edit
    expect(backends.resolveChatBackend().baseUrl).not.toContain('gen-only');
    expect(backends.resolveImageEditBackend().baseUrl).not.toContain('gen-only');
  });

  it('Grok chat settings send to the chat base with Authorization: Bearer', async () => {
    db.setSetting('chat_base_url', chatUp.baseUrl);
    db.setSetting('chat_api_key', 'sk-chat-bearer');
    db.setSetting('image_generate_base_url', imageUp.baseUrl);

    const req = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_id: convId,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    const res = await chatRoute.POST(req);
    expect(res.status).toBe(200);
    await drainStream(res);

    expect(chatUp.requests.length).toBeGreaterThan(0);
    const hit = chatUp.requests.find(r => r.url.includes('/chat/completions'));
    expect(hit).toBeTruthy();
    expect(hit!.authorization).toBe('Bearer sk-chat-bearer');
    expect(imageUp.requests.some(r => r.url.includes('/chat/completions'))).toBe(false);
  });

  it('finishes the pending assistant even if the client drops the stream', async () => {
    db.setSetting('chat_base_url', chatUp.baseUrl);
    db.setSetting('chat_api_key', 'sk-chat-bearer');
    const conv = db.createConversation('drop-client');
    db.addMessage(conv.id, 'user', 'hi');
    const pending = db.addMessage(conv.id, 'assistant', '', undefined, 'pending');

    const res = await chatRoute.POST(new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_id: conv.id, pendingMessageId: pending.id }),
    }));
    expect(res.status).toBe(200);
    await res.body?.cancel();
    for (let i = 0; i < 40; i++) {
      const msg = db.getMessage(pending.id);
      if (msg?.status === 'completed' && String(msg.content || '').includes('hello from chat')) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    const msg = db.getMessage(pending.id);
    expect(msg?.status).toBe('completed');
    expect(String(msg?.content || '')).toContain('hello from chat');
  });

  it('chat sends stable summary prefix + first turns + recent tail when history is long', async () => {
    db.setSetting('chat_base_url', chatUp.baseUrl);
    db.setSetting('chat_api_key', 'sk-chat-bearer');
    const conv = db.createConversation('long-chat-cache');
    for (let i = 0; i < 24; i++) {
      db.addMessage(conv.id, i % 2 ? 'assistant' : 'user', `turn-${i}`);
    }
    db.updateConversationSummary(conv.id, '角色是Vivian，正在海边');
    chatUp.requests.length = 0;

    const res = await chatRoute.POST(new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_id: conv.id }),
    }));
    expect(res.status).toBe(200);
    await drainStream(res);

    const hit = chatUp.requests.find((r: any) => r.url.includes('/chat/completions') && r.body?.stream);
    expect(hit).toBeTruthy();
    const sent = hit!.body.messages;
    expect(sent[0]).toEqual({ role: 'system', content: '[对话摘要]\n角色是Vivian，正在海边' });
    expect(sent[1].content).toBe('turn-0');
    expect(sent.at(-1).content).toBe('turn-23');
    expect(sent).toHaveLength(1 + 3 + 16);
    expect(sent.some((m: any) => m.content === 'turn-3')).toBe(false);
  });

  it('Grok chat saves image tool output with the model prompt, not the user text', async () => {
    upstreamState.responses = 'image';
    db.setSetting('chat_base_url', chatUp.baseUrl);
    db.setSetting('chat_api_key', 'sk-chat-bearer');
    const conv = db.createConversation('chat-draw');
    db.addMessage(conv.id, 'user', 'draw a shirt');
    chatUp.requests.length = 0;

    const res = await chatRoute.POST(new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_id: conv.id }),
    }));
    expect(res.status).toBe(200);
    const text = await drainStream(res);
    expect(text).toContain('画好了');
    expect(text).toContain('studio_image');
    expect(chatUp.requests.some((r) => r.url.includes('/responses'))).toBe(true);
    expect(chatUp.requests.some((r) => r.url.includes('/chat/completions'))).toBe(false);
    const hit = chatUp.requests.find((r) => r.url.includes('/responses'));
    expect(hit!.body.tools).toEqual([{ type: 'image_generation' }]);
    expect(hit!.body.store).toBe(false);
    expect(hit!.body.input.some((item: any) => item.role === 'user' && item.content === 'draw a shirt')).toBe(true);

    const imgs = db.listImages(conv.id);
    expect(imgs).toHaveLength(1);
    expect(imgs[0].prompt).toBe('a red silk shirt, woodblock');
    expect(imgs[0].aspect_ratio).toBe('16:9');
    expect(imgs[0].kind).toBe('generate');
    expect(imgs[0].extra_json.source).toBe('chat');
    expect(imgs[0].extra_json.call.prompt).toBe('a red silk shirt, woodblock');
    expect(imgs[0].extra_json.call.result).toBeUndefined();
    expect(imgs[0].extra_json.response_id).toBe('resp_test');
    expect(JSON.stringify(imgs[0].extra_json)).not.toContain(TINY_PNG);

    const assistant = db.listMessages(conv.id).find((m: any) => m.role === 'assistant');
    expect(assistant.content).toContain('画好了');
    expect(assistant.extra_json.images[0].id).toBe(imgs[0].id);
    expect(assistant.extra_json.image_calls[0].result).toBeUndefined();
  });

  it('Ollama chat does not call the Grok image tool', async () => {
    db.setSetting('chat_provider', 'ollama');
    db.setSetting('chat_base_url', chatUp.baseUrl);
    db.setSetting('chat_api_key', '');
    const conv = db.createConversation('ollama-no-draw');
    db.addMessage(conv.id, 'user', 'hi');
    chatUp.requests.length = 0;
    const res = await chatRoute.POST(new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_id: conv.id }),
    }));
    expect(res.status).toBe(200);
    await drainStream(res);
    expect(chatUp.requests.some((r) => r.url.includes('/responses'))).toBe(false);
    expect(chatUp.requests.some((r) => r.url.includes('/chat/completions'))).toBe(true);
  });

  it('Ollama chat succeeds with empty API key', async () => {
    db.setSetting('chat_provider', 'ollama');
    db.setSetting('chat_base_url', chatUp.baseUrl);
    db.setSetting('chat_api_key', '');
    db.setSetting('api_key', 'sk-must-not-be-sent');

    expect(backends.resolveChatBackend().apiKey).toBe('');

    const req = new Request('http://localhost/api/health', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'chat' }),
    });
    const res = await healthRoute.POST(req);
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);

    const hit = chatUp.requests.find(r => r.url.includes('/chat/completions'));
    expect(hit).toBeTruthy();
    expect(hit!.authorization).toBe('');
  });

  it('summarize and chat health use the chat backend, not the image URL', async () => {
    db.setSetting('chat_base_url', chatUp.baseUrl);
    db.setSetting('chat_api_key', 'sk-chat');
    db.setSetting('image_generate_base_url', imageUp.baseUrl);
    db.setSetting('image_generate_api_key', 'sk-image');

    const healthReq = new Request('http://localhost/api/health', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'chat' }),
    });
    const healthRes = await healthRoute.POST(healthReq);
    expect((await healthRes.json()).ok).toBe(true);
    expect(chatUp.requests.some(r => r.url.includes('/chat/completions'))).toBe(true);
    expect(imageUp.requests.some(r => r.url.includes('/chat/completions'))).toBe(false);

    chatUp.requests.length = 0;
    const sumConv = db.createConversation('summarize-backend');
    for (let i = 0; i < 24; i++) {
      db.addMessage(sumConv.id, i % 2 ? 'assistant' : 'user', `m${i}`);
    }
    const sumReq = new Request('http://localhost/api/conversations/x/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const sumRes = await summarizeRoute.POST(sumReq, { params: Promise.resolve({ id: sumConv.id }) });
    const sumData = await sumRes.json();
    expect(sumRes.status).toBe(200);
    expect(sumData.summary).toBeTruthy();
    expect(chatUp.requests.some(r => r.url.includes('/chat/completions'))).toBe(true);
    expect(imageUp.requests.length).toBe(0);
  });

  it('with chat URL ≠ image URL, outgoing requests hit the matching host', async () => {
    db.setSetting('chat_base_url', chatUp.baseUrl);
    db.setSetting('chat_api_key', 'sk-chat');
    db.setSetting('image_generate_base_url', imageUp.baseUrl);
    db.setSetting('image_generate_api_key', 'sk-image');

    await healthRoute.POST(new Request('http://localhost/api/health', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'chat' }),
    }));
    await generateRoute.POST(new Request('http://localhost/api/images/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'a cat', conversation_id: convId }),
    }));

    expect(chatUp.requests.every(r => r.url.includes('/chat/completions'))).toBe(true);
    expect(imageUp.requests.some(r => r.url.includes('/images/generations'))).toBe(true);
    expect(chatUp.requests.some(r => r.url.includes('/images/'))).toBe(false);
    expect(imageUp.requests.some(r => r.url.includes('/chat/'))).toBe(false);
  });

  it('Grok generate persists a completed image row + file under DATA_DIR', async () => {
    db.setSetting('image_generate_base_url', imageUp.baseUrl);
    db.setSetting('image_generate_api_key', 'sk-image');

    const res = await generateRoute.POST(new Request('http://localhost/api/images/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'persist me', conversation_id: convId }),
    }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.images?.length).toBeGreaterThan(0);
    const img = data.images[0];
    expect(img.status === 'completed' || !img.status).toBe(true);
    expect(img.file_path).toBeTruthy();
    expect(existsSync(join(TEST_DATA_DIR, img.file_path))).toBe(true);
    const row = db.getImage(img.id);
    expect(row).toBeTruthy();
    expect(row.sha256).toBeTruthy();
    expect(typeof row.extra_json?.elapsed_ms).toBe('number');
    expect(row.extra_json.elapsed_ms).toBeGreaterThanOrEqual(0);
    expect(row.extra_json.provider).toBe('grok');
  });

  it('Grok edit persists a completed image and hits /images/edits, not the Jetson gateway', async () => {
    db.setSetting('image_generate_base_url', imageUp.baseUrl);
    db.setSetting('image_generate_api_key', 'sk-image');
    db.setSetting('image_edit_base_url', imageUp.baseUrl);
    db.setSetting('image_edit_api_key', 'sk-edit');
    db.setSetting('image_generate_provider', 'jetson');
    db.setSetting('jetson_gateway_url', gateway.url);

    const gen = await generateRoute.POST(new Request('http://localhost/api/images/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'source', conversation_id: convId }),
    }));
    const genData = await gen.json();
    // jetson path is pending — seed a grok-completed source via generate after switching
    db.setSetting('image_generate_provider', 'grok');
    const grokGen = await generateRoute.POST(new Request('http://localhost/api/images/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'source-grok', conversation_id: convId }),
    }));
    const grokData = await grokGen.json();
    const source = grokData.images[0];
    expect(source.file_path).toBeTruthy();

    imageUp.requests.length = 0;
    const editRes = await editRoute.POST(new Request('http://localhost/api/images/edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'make it blue',
        image_id: source.id,
        conversation_id: convId,
      }),
    }));
    const editData = await editRes.json();
    expect(editRes.status).toBe(200);
    expect(editData.images?.length).toBeGreaterThan(0);
    const edited = editData.images[0];
    expect(existsSync(join(TEST_DATA_DIR, edited.file_path))).toBe(true);
    expect(imageUp.requests.some(r => r.url.includes('/images/edits'))).toBe(true);
    expect(imageUp.requests.some(r => r.url.includes('/v1/jobs'))).toBe(false);
  });

  it('Jetson generate POSTs OpenAI /images/generations with sd-cpp-local, size, b64_json', async () => {
    db.setSetting('image_generate_provider', 'jetson');
    db.setSetting('jetson_gateway_url', imageUp.baseUrl);
    db.setSetting('jetson_api_key', '');
    db.setSetting('api_key', 'sk-must-not-go-to-imagen');
    db.setSetting('jetson_steps', '4');
    db.setSetting('jetson_seed', '357925');
    db.setSetting('image_generate_model', '');

    expect(backends.resolveImageGenerateBackend().model).toBe('sd-cpp-local');
    expect(backends.resolveImageGenerateBackend().jetsonApiKey).toBe('');

    imageUp.requests.length = 0;
    const res = await generateRoute.POST(new Request('http://localhost/api/images/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'A lovely cat', conversation_id: convId, aspect_ratio: '1:1', resolution: '512' }),
    }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.images[0].status).toBe('pending');
    const imageId = data.images[0].id;

    const deadline = Date.now() + 8000;
    let latest: any;
    while (Date.now() < deadline) {
      const got = await imageIdRoute.GET(new Request('http://localhost'), { params: Promise.resolve({ id: imageId }) });
      latest = await got.json();
      if (latest.status === 'completed' || latest.status === 'error') break;
      await new Promise((r) => setTimeout(r, 30));
    }
    expect(latest.status).toBe('completed');
    expect(existsSync(join(TEST_DATA_DIR, latest.file_path))).toBe(true);

    const hit = imageUp.requests.find(r => r.url.includes('/images/generations'));
    expect(hit).toBeTruthy();
    expect(hit!.authorization).toBe('');
    expect(hit!.body.model).toBe('sd-cpp-local');
    expect(hit!.body.response_format).toBe('b64_json');
    expect(hit!.body.size).toMatch(/^\d+x\d+$/);
    const [w, h] = hit!.body.size.split('x').map(Number);
    expect(w % 16).toBe(0);
    expect(h % 16).toBe(0);
    expect(hit!.body.prompt).toContain('A lovely cat');
    expect(hit!.body.prompt).toContain('<sd_cpp_extra_args>');
    expect(hit!.body.prompt).toContain('"steps":4');
    expect(hit!.body.prompt).toContain('"seed":357925');
  });

  it('Jetson health uses GET /v1/models, not the Grok image URL', async () => {
    db.setSetting('image_generate_provider', 'jetson');
    db.setSetting('jetson_gateway_url', imageUp.baseUrl);
    db.setSetting('image_generate_base_url', 'http://grok-image.example/v1');
    imageUp.requests.length = 0;
    const res = await healthRoute.POST(new Request('http://localhost/api/health', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'jetson' }),
    }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(imageUp.requests.some(r => r.method === 'GET' && r.url.includes('/models'))).toBe(true);
  });

  it('Jetson generate records pending then archives a completed file after job completion', async () => {
    db.setSetting('image_generate_provider', 'jetson');
    db.setSetting('jetson_gateway_url', gateway.url);

    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    setInferHook(async () => {
      await gate;
      return { images: [{ b64_json: TINY_PNG }] };
    });

    const res = await generateRoute.POST(new Request('http://localhost/api/images/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'jetson cat', conversation_id: convId }),
    }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.images[0].status).toBe('pending');
    const imageId = data.images[0].id;
    expect(data.images[0].file_path).toBe('');

    release();

    let latest: any;
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const got = await imageIdRoute.GET(new Request('http://localhost'), { params: Promise.resolve({ id: imageId }) });
      latest = await got.json();
      if (latest.status === 'completed') break;
      await new Promise((r) => setTimeout(r, 40));
    }
    expect(latest.status).toBe('completed');
    expect(latest.file_path).toBeTruthy();
    expect(existsSync(join(TEST_DATA_DIR, latest.file_path))).toBe(true);
    const row = db.getImage(imageId);
    expect(row.status).toBe('completed');
    expect(row.sha256).toBeTruthy();
  });
});
