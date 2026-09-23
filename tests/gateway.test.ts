/** @vitest-environment node */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import { join } from 'path';
import {
  enqueueJob,
  getJob,
  getHealth,
  setInferHook,
  resetQueue,
} from '../gateway/queue.mjs';
import { startGateway, resetQueue as resetServerQueue, setInferHook as setServerHook } from '../gateway/server.mjs';

const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor<T>(fn: () => T | Promise<T>, pred: (v: T) => boolean, timeout = 8000) {
  const start = Date.now();
  let last: T | undefined;
  while (Date.now() - start < timeout) {
    last = await fn();
    if (pred(last)) return last;
    await sleep(30);
  }
  throw new Error(`timeout waiting; last=${JSON.stringify(last)}`);
}

describe('Jetson gateway queue (shipped module)', () => {
  beforeEach(() => {
    resetQueue();
  });

  it('runs one job at a time and reports queue_depth; second waits until first finishes', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    setInferHook(async () => {
      await gate;
      return { images: [{ b64_json: TINY_PNG }] };
    });

    const first = enqueueJob({ prompt: 'one' });
    const second = enqueueJob({ prompt: 'two' });

    await waitFor(() => getJob(first.id), (j) => j?.status === 'running');
    expect(getJob(second.id)?.status).toBe('queued');
    const health = getHealth();
    expect(health.queue_depth).toBeGreaterThanOrEqual(1);
    expect(typeof health.queue_depth).toBe('number');

    release();
    await waitFor(() => getJob(first.id), (j) => j?.status === 'completed');
    await waitFor(() => getJob(second.id), (j) => j?.status === 'completed');
    expect(getJob(first.id)?.images?.[0]?.b64_json).toBeTruthy();
    expect(getHealth().queue_depth).toBe(0);
  });
});

describe('Jetson gateway HTTP job API (shipped server)', () => {
  let url: string;
  let server: { close: (cb?: any) => void };

  beforeEach(async () => {
    resetServerQueue();
    const started = await startGateway(0, '127.0.0.1');
    url = started.url;
    server = started.server;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    resetServerQueue();
  });

  it('POST job, GET status, second job queues, health includes queue_depth', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    setServerHook(async () => {
      await gate;
      return { images: [{ b64_json: TINY_PNG }] };
    });

    const r1 = await fetch(`${url}/v1/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'first', delay_ms: 0 }),
    });
    expect(r1.status).toBe(200);
    const j1 = await r1.json();
    expect(j1.id).toBeTruthy();

    const r2 = await fetch(`${url}/v1/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'second' }),
    });
    const j2 = await r2.json();

    const runningOrQueued = await waitFor(
      async () => (await (await fetch(`${url}/v1/jobs/${j1.id}`)).json()),
      (j) => j.status === 'running' || j.status === 'completed'
    );
    const j2status = await (await fetch(`${url}/v1/jobs/${j2.id}`)).json();
    if (runningOrQueued.status === 'running') {
      expect(j2status.status).toBe('queued');
    }

    const healthRes = await fetch(`${url}/v1/health`);
    const health = await healthRes.json();
    expect(healthRes.status).toBe(200);
    expect(typeof health.queue_depth).toBe('number');
    if (runningOrQueued.status === 'running') {
      expect(health.queue_depth).toBeGreaterThanOrEqual(1);
    }

    const metrics = await (await fetch(`${url}/metrics`)).text();
    expect(metrics).toContain('jetson_queue_depth');

    release();
    const done1 = await waitFor(
      async () => (await (await fetch(`${url}/v1/jobs/${j1.id}`)).json()),
      (j) => j.status === 'completed'
    );
    expect(done1.status).toBe('completed');
    const done2 = await waitFor(
      async () => (await (await fetch(`${url}/v1/jobs/${j2.id}`)).json()),
      (j) => j.status === 'completed'
    );
    expect(done2.status).toBe('completed');
    expect(done2.images?.[0]?.b64_json).toBeTruthy();
  });

  it('OpenAI /v1/images/generations waits on the queue and returns b64_json; /v1/models lists sd-cpp-local', async () => {
    const models = await (await fetch(`${url}/v1/models`)).json();
    expect(models.data?.[0]?.id).toBe('sd-cpp-local');

    const res = await fetch(`${url}/v1/images/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'sd-cpp-local',
        prompt: 'A lovely cat',
        n: 1,
        size: '512x512',
        response_format: 'b64_json',
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data?.[0]?.b64_json).toBeTruthy();

    const bad = await fetch(`${url}/v1/images/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'nope', size: '17x17', response_format: 'b64_json' }),
    });
    expect(bad.status).toBe(400);
  });
});

describe('Jetson gateway process boot', () => {
  it('starts node gateway/server.mjs and serves health with queue_depth', async () => {
    const port = 18787;
    const logChunks: string[] = [];
    let child: ChildProcess | null = null;
    try {
      child = spawn(process.execPath, [join(process.cwd(), 'gateway/server.mjs')], {
        env: {
          ...process.env,
          JETSON_GATEWAY_PORT: String(port),
          JETSON_GATEWAY_HOST: '127.0.0.1',
        },
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.stdout?.on('data', (d) => logChunks.push(String(d)));
      child.stderr?.on('data', (d) => logChunks.push(String(d)));

      const health = await waitFor(
        async () => {
          try {
            const res = await fetch(`http://127.0.0.1:${port}/v1/health`);
            return await res.json();
          } catch {
            return null;
          }
        },
        (v) => v && typeof v.queue_depth === 'number',
        8000
      );
      expect(health.queue_depth).toBeDefined();

      const posted = await fetch(`http://127.0.0.1:${port}/v1/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'boot', delay_ms: 200 }),
      });
      const job = await posted.json();
      const finished = await waitFor(
        async () => (await (await fetch(`http://127.0.0.1:${port}/v1/jobs/${job.id}`)).json()),
        (j) => j.status === 'completed' || j.status === 'failed'
      );
      expect(finished.status).toBe('completed');
    } catch (e: any) {
      e.message = `${e?.message || e}\n--- gateway log ---\n${logChunks.join('')}`;
      throw e;
    } finally {
      if (child && child.pid) {
        child.kill('SIGTERM');
        await sleep(200);
        try { child.kill('SIGKILL'); } catch {}
      }
    }
  });
});
