/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'http';
import { join } from 'path';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { vi } from 'vitest';

const TEST_DATA_DIR = join(process.cwd(), 'tests', '.tmp-tts');
process.env.DATA_DIR = TEST_DATA_DIR;
if (existsSync(TEST_DATA_DIR)) rmSync(TEST_DATA_DIR, { recursive: true, force: true });
mkdirSync(TEST_DATA_DIR, { recursive: true });

const TINY_WAV = Buffer.from(
  'RIFF$\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00D\xac\x00\x00\x88X\x01\x00\x02\x00\x10\x00data\x00\x00\x00\x00',
  'binary'
);

function startFakeTts(opts: { ready?: boolean; mode?: string } = {}) {
  let ready = opts.ready !== false;
  let mode = opts.mode || 'custom';
  const requests: { method?: string; url: string; contentType?: string; body: any }[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const rawBuf = Buffer.concat(chunks);
    const raw = rawBuf.toString('utf8');
    let body: any = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = { raw }; }
    requests.push({ method: req.method, url: req.url || '', contentType: String(req.headers['content-type'] || ''), body });

    if (req.url === '/health') {
      const voices = mode === 'clone' ? ['dynamic'] : ['vivian', 'aiden'];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', ready, model_loaded: ready, mode, voices, default_voice: voices[0] }));
      return;
    }
    if (req.url === '/v1/audio/voices') {
      const voices = mode === 'clone' ? ['dynamic'] : ['vivian', 'aiden', 'uncle_fu'];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ voices, default_voice: voices[0], mode }));
      return;
    }
    if (req.url === '/v1/audio/voice-clone/pt' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.end(Buffer.from('FAKE_SPEAKER_PT'));
      return;
    }
    if (req.url === '/v1/audio/speech' && req.method === 'POST') {
      if (!ready) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: 'Model not loaded' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'audio/wav', 'Transfer-Encoding': 'chunked' });
      res.write(TINY_WAV.subarray(0, 44));
      res.write(TINY_WAV.subarray(44));
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });

  return new Promise<{ server: Server; url: string; requests: typeof requests; setReady: (v: boolean) => void; setMode: (m: string) => void }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        server,
        url: `http://127.0.0.1:${port}`,
        requests,
        setReady: (v) => { ready = v; },
        setMode: (m) => { mode = m; },
      });
    });
  });
}

describe('Qwen3TTS integration', () => {
  let fake: Awaited<ReturnType<typeof startFakeTts>>;
  let vendorsApi: any;
  let bindingsApi: any;
  let modelsApi: any;
  let ttsApi: any;
  let healthApi: any;
  let backends: any;
  let db: any;

  beforeAll(async () => {
    vi.resetModules();
    process.env.DATA_DIR = TEST_DATA_DIR;
    fake = await startFakeTts({ ready: true });
    vendorsApi = await import('../app/api/vendors/route');
    bindingsApi = await import('../app/api/bindings/route');
    modelsApi = await import('../app/api/vendors/models/route');
    ttsApi = await import('../app/api/tts/route');
    healthApi = await import('../app/api/health/route');
    backends = await import('../app/lib/backends');
    db = await import('../app/lib/db');
    const catalog = await import('../app/lib/integrations/catalog');
    expect(catalog.hasCapability('qwen3tts', 'speech')).toBe(true);
    expect(catalog.hasCapability('qwen3tts', 'image.edit')).toBe(false);
  });

  afterAll(async () => {
    fake?.server.close();
    if (existsSync(TEST_DATA_DIR)) {
      try { rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch {}
    }
  });

  it('pulls voices from /v1/audio/voices and binds speech', async () => {
    const created = await vendorsApi.POST(new Request('http://localhost/api/vendors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'qwen3tts',
        label: 'Qwen3TTS',
        base_url: fake.url,
        extra: { language: 'Chinese', instruct: '请用温和语气朗读。', seed: '1234' },
        models: [{ model: 'vivian', capabilities: ['speech'] }],
      }),
    }));
    const { vendor } = await created.json();
    expect(vendor.kind).toBe('qwen3tts');

    const listed = await modelsApi.POST(new Request('http://localhost/api/vendors/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vendor_id: vendor.id }),
    }));
    const listData = await listed.json();
    expect(listed.status).toBe(200);
    const ids = (listData.models || []).map((m: any) => m.id);
    expect(ids).toContain('vivian');
    expect(ids).toContain('uncle_fu');
    expect(listData.models[0].suggested).toContain('speech');
    expect(listData.endpoint).toContain('/v1/audio/voices');

    const bind = await bindingsApi.POST(new Request('http://localhost/api/bindings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capability: 'speech', vendor_id: vendor.id, model: 'vivian' }),
    }));
    expect(bind.status).toBe(200);

    const speech = backends.resolveSpeechBackend();
    expect(speech.provider).toBe('qwen3tts');
    expect(speech.voice).toBe('vivian');
    expect(speech.baseUrl).toBe(fake.url);
    expect(speech.language).toBe('Chinese');
    expect(speech.instruct).toContain('温和');
  });

  it('POST /api/tts hits /v1/audio/speech with OpenAI-compatible body and returns wav', async () => {
    fake.requests.length = 0;
    const res = await ttsApi.POST(new Request('http://localhost/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '欢迎使用 Qwen3TTS 服务。' }),
    }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('audio/wav');
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.length).toBeGreaterThan(10);

    const hit = fake.requests.find((r) => r.url === '/v1/audio/speech');
    expect(hit).toBeTruthy();
    expect(hit!.body.model).toBe('tts-1');
    expect(hit!.body.input).toContain('欢迎');
    expect(hit!.body.voice).toBe('vivian');
    expect(hit!.body.response_format).toBe('wav');
    expect(hit!.body.language).toBe('Chinese');
    expect(hit!.body.instruct).toContain('温和');
    expect(hit!.body.seed).toBe(1234);
  });

  it('streams wav, persists under data/audio, and replays without calling speech again', async () => {
    const conv = db.createConversation('tts-cache');
    const msg = db.addMessage(conv.id, 'assistant', '欢迎使用 Qwen3TTS 服务。');
    fake.requests.length = 0;

    const first = await ttsApi.POST(new Request('http://localhost/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: msg.content, message_id: msg.id }),
    }));
    expect(first.status).toBe(200);
    expect(first.headers.get('X-Audio-Cached')).toBe('0');
    const rel = first.headers.get('X-Audio-Path');
    expect(rel).toBe(`audio/${msg.id}.wav`);
    const bytes = Buffer.from(await first.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(10);

    const saved = db.getMessage(msg.id);
    expect(saved.extra_json.audio_path).toBe(rel);
    expect(existsSync(join(TEST_DATA_DIR, rel!))).toBe(true);

    const speechCalls = fake.requests.filter((r) => r.url === '/v1/audio/speech').length;
    expect(speechCalls).toBe(1);

    const second = await ttsApi.POST(new Request('http://localhost/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: msg.content, message_id: msg.id }),
    }));
    expect(second.status).toBe(200);
    expect(second.headers.get('X-Audio-Cached')).toBe('1');
    expect(fake.requests.filter((r) => r.url === '/v1/audio/speech').length).toBe(1);

    const { parseWavHeader } = await import('../app/lib/wav-stream-player');
    const fmt = parseWavHeader(new Uint8Array(TINY_WAV));
    expect(fmt?.sampleRate).toBe(44100);
    expect(fmt?.channels).toBe(1);
    expect(fmt?.dataOffset).toBe(44);
    expect(fmt?.audioFormat).toBe(1);
  });

  it('health type=tts requires ready=true', async () => {
    fake.setReady(true);
    const ok = await healthApi.POST(new Request('http://localhost/api/health', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'tts' }),
    }));
    const okData = await ok.json();
    expect(okData.ok).toBe(true);
    expect(okData.body.ready).toBe(true);

    fake.setReady(false);
    const bad = await healthApi.POST(new Request('http://localhost/api/health', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'tts' }),
    }));
    const badData = await bad.json();
    expect(badData.ok).toBe(false);
  });

  it('clone mode without speaker.pt is rejected; clone then speech uses multipart', async () => {
    fake.setMode('clone');
    fake.setReady(true);
    const created = await vendorsApi.POST(new Request('http://localhost/api/vendors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'qwen3tts',
        label: 'CloneTTS',
        base_url: fake.url,
        models: [{ model: 'dynamic', capabilities: ['speech'] }],
      }),
    }));
    const { vendor } = await created.json();
    await bindingsApi.POST(new Request('http://localhost/api/bindings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capability: 'speech', vendor_id: vendor.id, model: 'dynamic' }),
    }));

    const denied = await ttsApi.POST(new Request('http://localhost/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '没有音色' }),
    }));
    expect(denied.status).toBe(400);
    const deniedBody = await denied.json();
    expect(deniedBody.error).toMatch(/clone/);

    const cloneRoute = await import('../app/api/tts/clone/route');
    const fd = new FormData();
    fd.set('vendor_id', vendor.id);
    fd.set('name', 'alice');
    fd.set('ref_audio', new File([Buffer.concat([TINY_WAV, Buffer.alloc(200)])], 'ref.wav', { type: 'audio/wav' }));
    const cloned = await cloneRoute.POST(new Request('http://localhost/api/tts/clone', { method: 'POST', body: fd }));
    const clonedData = await cloned.json();
    expect(cloned.status).toBe(200);
    expect(clonedData.voice).toBe('alice');
    expect(clonedData.speaker_pt).toContain('voices/');

    fake.requests.length = 0;
    const spoken = await ttsApi.POST(new Request('http://localhost/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '克隆音色测试' }),
    }));
    expect(spoken.status).toBe(200);
    const speech = fake.requests.find((r) => r.url === '/v1/audio/speech');
    expect(speech?.contentType).toContain('multipart/form-data');
    fake.setMode('custom');
  });
});
