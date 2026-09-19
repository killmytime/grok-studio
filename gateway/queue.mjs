import { mkdirSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 1x1 PNG — GPU-free placeholder so the job API works without Z-Image weights. */
export const PLACEHOLDER_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const jobs = new Map();
const pending = [];
let runningId = null;
let inferHook = defaultInfer;

function scratchDir() {
  return process.env.JETSON_SCRATCH_DIR || join(__dirname, '.scratch');
}

function ensureScratch() {
  const dir = scratchDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function defaultInfer(job) {
  const delay = Number(job.payload?.delay_ms ?? 40);
  if (delay > 0) {
    await new Promise((resolve) => {
      job._timer = setTimeout(resolve, delay);
    });
  }
  const n = Math.min(Math.max(1, Number(job.payload?.n || 1)), 4);
  const images = [];
  for (let i = 0; i < n; i++) images.push({ b64_json: PLACEHOLDER_PNG_B64 });
  return { images };
}

function updatePositions() {
  pending.forEach((id, idx) => {
    const job = jobs.get(id);
    if (job) job.position = idx + 1;
  });
  if (runningId) {
    const running = jobs.get(runningId);
    if (running) running.position = 0;
  }
}

async function pump() {
  if (runningId) return;
  const next = pending.shift();
  if (!next) return;
  const job = jobs.get(next);
  if (!job || job.status === 'cancelled') {
    setImmediate(pump);
    return;
  }
  runningId = next;
  job.status = 'running';
  job.progress = 1;
  updatePositions();
  try {
    const result = await inferHook(job);
    if (job.status === 'cancelled') return;
    job.images = result?.images || [];
    writeScratch(job);
    job.status = 'completed';
    job.progress = 100;
  } catch (e) {
    if (job.status !== 'cancelled') {
      job.status = 'failed';
      job.error = e?.message || String(e);
    }
  } finally {
    if (runningId === next) runningId = null;
    updatePositions();
    setImmediate(pump);
  }
}

function writeScratch(job) {
  try {
    const dir = ensureScratch();
    const first = job.images?.[0];
    const b64 = first?.b64_json;
    if (!b64) return;
    const file = join(dir, `${job.id}.png`);
    writeFileSync(file, Buffer.from(b64, 'base64'));
    job.scratch_path = file;
    // TTL cleanup — gateway files are scratch only, not the product archive
    const ttl = Number(process.env.JETSON_SCRATCH_TTL_MS || 10 * 60 * 1000);
    setTimeout(() => {
      try {
        if (existsSync(file)) unlinkSync(file);
      } catch {}
    }, ttl).unref?.();
  } catch {
    // scratch write is best-effort
  }
}

export function setInferHook(fn) {
  inferHook = typeof fn === 'function' ? fn : defaultInfer;
}

export function resetInferHook() {
  inferHook = defaultInfer;
}

export function enqueueJob(payload = {}) {
  const id = randomUUID();
  const job = {
    id,
    status: 'queued',
    position: pending.length + (runningId ? 1 : 0),
    progress: 0,
    payload,
    createdAt: Date.now(),
    images: null,
    error: null,
    scratch_path: null,
  };
  jobs.set(id, job);
  pending.push(id);
  updatePositions();
  setImmediate(pump);
  return publicJob(job);
}

export function getJob(id) {
  const job = jobs.get(id);
  return job ? publicJob(job) : null;
}

export function getJobRaw(id) {
  return jobs.get(id) || null;
}

export function cancelJob(id) {
  const job = jobs.get(id);
  if (!job) return null;
  if (job.status === 'completed' || job.status === 'failed') return publicJob(job);
  const idx = pending.indexOf(id);
  if (idx >= 0) pending.splice(idx, 1);
  if (job._timer) clearTimeout(job._timer);
  job.status = 'cancelled';
  job.error = 'cancelled';
  if (runningId === id) runningId = null;
  updatePositions();
  setImmediate(pump);
  return publicJob(job);
}

export function getHealth() {
  const queued = pending.length;
  const running = runningId ? 1 : 0;
  return {
    ok: true,
    model_loaded: true,
    model: process.env.JETSON_MODEL || 'sd-cpp-local',
    queue_depth: queued + running,
    queued,
    running,
    running_job_id: runningId,
    vram: { used_mb: 0, total_mb: 0 },
    inference: inferHook === defaultInfer ? 'placeholder' : 'custom',
  };
}

export function resetQueue() {
  for (const job of jobs.values()) {
    if (job._timer) clearTimeout(job._timer);
  }
  jobs.clear();
  pending.length = 0;
  runningId = null;
  resetInferHook();
}

export function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    position: job.position,
    progress: job.progress,
    images: job.images,
    error: job.error,
    scratch_path: job.scratch_path,
    createdAt: job.createdAt,
  };
}

export function waitForJob(id, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const job = jobs.get(id);
      if (!job) return reject(new Error('job not found'));
      if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
        return resolve(publicJob(job));
      }
      if (Date.now() - start > timeoutMs) return reject(new Error('job timeout'));
      setTimeout(tick, 20);
    };
    tick();
  });
}

export { sleep };
