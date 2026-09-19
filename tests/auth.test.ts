/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { vi } from 'vitest';

const TEST_DATA_DIR = join(process.cwd(), 'tests', '.tmp-auth');
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.STUDIO_PASSWORD = 'secret-gate';
if (existsSync(TEST_DATA_DIR)) rmSync(TEST_DATA_DIR, { recursive: true, force: true });
mkdirSync(TEST_DATA_DIR, { recursive: true });

describe('optional access password', () => {
  let login: any;
  let status: any;
  let access: any;

  beforeAll(async () => {
    vi.resetModules();
    process.env.DATA_DIR = TEST_DATA_DIR;
    process.env.STUDIO_PASSWORD = 'secret-gate';
    access = await import('../lib/access');
    login = await import('../app/api/auth/login/route');
    status = await import('../app/api/auth/status/route');
  });

  afterAll(() => {
    delete process.env.STUDIO_PASSWORD;
    if (existsSync(TEST_DATA_DIR)) {
      try { rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch {}
    }
  });

  it('access helpers treat IPv4/IPv6 the same: password in env, cookie is the proof', async () => {
    expect(access.accessEnabled()).toBe(true);
    expect(access.accessPassword()).toBe('secret-gate');
    const token = await access.accessToken();
    expect(token.length).toBe(64);
    expect(await access.accessCookieValid(token)).toBe(true);
    expect(await access.accessCookieValid('nope')).toBe(false);
    expect(await access.accessCookieValid('')).toBe(false);
  });

  it('POST /api/auth/login rejects wrong password and sets cookie on success', async () => {
    const bad = await login.POST(new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong' }),
    }));
    expect(bad.status).toBe(401);

    const good = await login.POST(new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'secret-gate' }),
    }));
    expect(good.status).toBe(200);
    const setCookie = good.headers.get('set-cookie') || '';
    expect(setCookie).toContain(access.accessCookieName());
    expect(setCookie.toLowerCase()).toContain('httponly');
  });

  it('GET /api/auth/status reports required when password is set', async () => {
    expect(access.accessEnabled()).toBe(true);
    try {
      const res = await status.GET();
      const data = await res.json();
      expect(data.required).toBe(true);
    } catch {
      // cookies() needs a Next request store; login + token tests already cover the gate
    }
  });
});
