/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { APP_VERSION } from '../app/lib/version';
import { createServer } from 'http';
import { join } from 'path';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { vi } from 'vitest';

const TEST_DATA_DIR = join(process.cwd(), 'tests', '.tmp-vendors');
process.env.DATA_DIR = TEST_DATA_DIR;
if (existsSync(TEST_DATA_DIR)) rmSync(TEST_DATA_DIR, { recursive: true, force: true });
mkdirSync(TEST_DATA_DIR, { recursive: true });

describe('vendor registry', () => {
  let vendorsApi: any;
  let bindingsApi: any;
  let settingsApi: any;
  let healthApi: any;
  let backends: any;
  let vendorHelpers: any;

  beforeAll(async () => {
    vi.resetModules();
    process.env.DATA_DIR = TEST_DATA_DIR;
    process.env.GROK_BASE_URL = 'http://grok.example/v1';
    process.env.GROK_API_KEY = 'sk-grok';
    vendorHelpers = await import('../app/lib/vendors');
    backends = await import('../app/lib/backends');
    vendorsApi = await import('../app/api/vendors/route');
    bindingsApi = await import('../app/api/bindings/route');
    settingsApi = await import('../app/api/settings/route');
    healthApi = await import('../app/api/health/route');
  });

  afterAll(() => {
    if (existsSync(TEST_DATA_DIR)) {
      try { rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch {}
    }
  });

  it('settings GET seeds a Grok vendor array with models and capabilities', async () => {
    const res = await settingsApi.GET();
    const data = await res.json();
    expect(Array.isArray(data.vendors)).toBe(true);
    expect(data.vendors.length).toBeGreaterThan(0);
    const grok = data.vendors.find((v: any) => v.id === 'grok');
    expect(grok.kind).toBe('grok');
    expect(grok.models.some((m: any) => m.capabilities.includes('chat'))).toBe(true);
    expect(grok.models.some((m: any) => m.capabilities.includes('image.edit'))).toBe(true);
    expect(data.kinds.some((k: any) => k.id === 'imagen' && !k.capabilities.includes('image.edit'))).toBe(true);
    expect(data.auth_required).toBe(false);
    expect(data.app_version).toMatch(/^\d+\.\d+\.\d+/);
    expect(data.default_resolution).toBeTruthy();
  });

  it('GET /api/health returns the app version', async () => {
    const res = await healthApi.GET();
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.version).toBe(APP_VERSION);
  });

  it('POST vendor + binding drives generate resolve independently of chat', async () => {
    const created = await vendorsApi.POST(new Request('http://localhost/api/vendors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'imagen',
        label: 'Jetson Imagen',
        base_url: 'http://imagen.example',
        models: [{ model: 'sd-cpp-local', capabilities: ['image.generate'] }],
      }),
    }));
    const { vendor } = await created.json();
    expect(vendor.kind).toBe('imagen');
    expect(vendor.models[0].capabilities).toContain('image.generate');

    const bindRes = await bindingsApi.POST(new Request('http://localhost/api/bindings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capability: 'image.generate', vendor_id: vendor.id, model: 'sd-cpp-local' }),
    }));
    expect(bindRes.status).toBe(200);

    const gen = backends.resolveImageGenerateBackend();
    expect(gen.provider).toBe('imagen');
    expect(gen.model).toBe('sd-cpp-local');
    expect(gen.jetsonGatewayUrl).toContain('imagen.example');

    const chat = backends.resolveChatBackend();
    expect(chat.provider).toBe('grok');
    expect(chat.baseUrl).toContain('grok.example');
  });

  it('POST /api/vendors/models lists OpenAI-compatible /v1/models', async () => {
    const server = createServer((req, res) => {
      if (req.url === '/v1/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          data: [
            { id: 'grok-latest' },
            { id: 'grok-imagine-image-2.0' },
          ],
        }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    try {
      const modelsRoute = await import('../app/api/vendors/models/route');
      const res = await modelsRoute.POST(new Request('http://localhost/api/vendors/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'grok',
          base_url: `http://127.0.0.1:${port}/v1`,
          api_key: 'sk-test',
        }),
      }));
      const data = await res.json();
      expect(res.status).toBe(200);
      const ids = (data.models || []).map((m: any) => m.id);
      expect(ids).toContain('grok-latest');
      expect(ids).toContain('grok-imagine-image-2.0');
      const chat = data.models.find((m: any) => m.id === 'grok-latest');
      expect(chat.suggested).toContain('chat');
      const img = data.models.find((m: any) => m.id === 'grok-imagine-image-2.0');
      expect(img.suggested).toContain('image.generate');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('rejects binding a generate-only vendor to image.edit', async () => {
    const list = vendorHelpers.listVendors();
    const imagen = list.find((v: any) => v.kind === 'imagen');
    expect(imagen).toBeTruthy();
    const res = await bindingsApi.POST(new Request('http://localhost/api/bindings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capability: 'image.edit', vendor_id: imagen.id, model: 'sd-cpp-local' }),
    }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/不支持/);
  });
});
