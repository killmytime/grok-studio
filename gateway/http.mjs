import { readFileSync, existsSync } from 'fs';
import { enqueueJob, getJob, getJobRaw, cancelJob, getHealth, waitForJob } from './queue.mjs';

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const err = new Error('invalid json');
    err.status = 400;
    throw err;
  }
}

function send(res, status, body, headers = {}) {
  const json = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(json);
}

function unauthorized(req) {
  const required = process.env.JETSON_API_KEY;
  if (!required) return false;
  const got = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return got !== required;
}

export async function handleGatewayRequest(req, res) {
  const url = new URL(req.url || '/', 'http://gateway.local');
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  const method = (req.method || 'GET').toUpperCase();

  if (pathname === '/health' || pathname === '/v1/health') {
    return send(res, 200, getHealth());
  }

  if (method === 'GET' && pathname === '/v1/models') {
    return send(res, 200, {
      object: 'list',
      data: [{ id: 'sd-cpp-local', object: 'model', owned_by: 'z-image-turbo' }],
    });
  }

  if (pathname === '/metrics') {
    const health = getHealth();
    const text = [
      '# TYPE jetson_queue_depth gauge',
      `jetson_queue_depth ${health.queue_depth}`,
      `jetson_queue_queued ${health.queued}`,
      `jetson_queue_running ${health.running}`,
      '',
    ].join('\n');
    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
    res.end(text);
    return;
  }

  if (unauthorized(req) && pathname !== '/') {
    return send(res, 401, { error: 'unauthorized' });
  }

  if (method === 'POST' && pathname === '/v1/images/generations') {
    const payload = await readJsonBody(req);
    const sizeMatch = String(payload.size || '').match(/^(\d+)\s*x\s*(\d+)$/i);
    const width = sizeMatch ? Number(sizeMatch[1]) : payload.width;
    const height = sizeMatch ? Number(sizeMatch[2]) : payload.height;
    if (width && (width % 16 !== 0 || height % 16 !== 0)) {
      return send(res, 400, { error: 'size width and height must be multiples of 16' });
    }
    const job = enqueueJob({
      ...payload,
      width,
      height,
      n: payload.n || 1,
      prompt: payload.prompt,
    });
    try {
      const done = await waitForJob(job.id);
      if (done.status !== 'completed') {
        return send(res, 502, { error: done.error || done.status, job_id: done.id });
      }
      return send(res, 200, {
        created: Math.floor(Date.now() / 1000),
        data: (done.images || []).map((img) => ({
          b64_json: img.b64_json,
          url: img.url,
        })),
      });
    } catch (e) {
      return send(res, 502, { error: e.message || 'generation failed', job_id: job.id });
    }
  }

  if (method === 'POST' && pathname === '/v1/jobs') {
    const payload = await readJsonBody(req);
    const job = enqueueJob(payload);
    return send(res, 200, job);
  }

  const jobMatch = pathname.match(/^\/v1\/jobs\/([^/]+)(?:\/(result))?$/);
  if (jobMatch) {
    const id = decodeURIComponent(jobMatch[1]);
    const isResult = jobMatch[2] === 'result';
    if (method === 'GET' && isResult) {
      const raw = getJobRaw(id);
      if (!raw) return send(res, 404, { error: 'job not found' });
      if (raw.scratch_path && existsSync(raw.scratch_path)) {
        const buf = readFileSync(raw.scratch_path);
        res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': buf.length });
        res.end(buf);
        return;
      }
      return send(res, 404, { error: 'result not ready' });
    }
    if (method === 'GET') {
      const job = getJob(id);
      if (!job) return send(res, 404, { error: 'job not found' });
      return send(res, 200, job);
    }
    if (method === 'DELETE') {
      const job = cancelJob(id);
      if (!job) return send(res, 404, { error: 'job not found' });
      return send(res, 200, job);
    }
  }

  if (pathname === '/' && method === 'GET') {
    return send(res, 200, { service: 'jetson-image-gateway', ...getHealth() });
  }

  return send(res, 404, { error: 'not found' });
}
