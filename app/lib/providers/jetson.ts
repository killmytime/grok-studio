import { bearerHeaders, normalizeImagenBaseUrl } from '../backends';

function imagenRoot(url: string): string {
  return normalizeImagenBaseUrl(url);
}

async function jetsonFetch(gatewayUrl: string, apiKey: string, path: string, init?: RequestInit): Promise<Response> {
  const headers = bearerHeaders(apiKey);
  return fetch(`${imagenRoot(gatewayUrl)}${path}`, {
    ...init,
    headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
  });
}

export async function jetsonImagesGenerations(
  gatewayUrl: string,
  apiKey: string,
  body: {
    model?: string;
    prompt: string;
    n?: number;
    size: string;
    response_format?: 'b64_json';
  },
  signal?: AbortSignal
) {
  const res = await jetsonFetch(gatewayUrl, apiKey, '/images/generations', {
    method: 'POST',
    body: JSON.stringify({
      model: body.model || 'sd-cpp-local',
      prompt: body.prompt,
      n: body.n ?? 1,
      size: body.size,
      response_format: 'b64_json',
    }),
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || data.message || `Jetson generate failed: ${res.status}`) as Error & {
      status: number;
      body: unknown;
    };
    err.status = res.status >= 400 ? res.status : 502;
    err.body = data;
    throw err;
  }
  return data;
}

/** @deprecated job API is local-gateway only; imagen uses OpenAI /images/generations */
export async function jetsonEnqueue(gatewayUrl: string, apiKey: string, payload: Record<string, unknown>) {
  const res = await jetsonFetch(gatewayUrl, apiKey, '/jobs', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Jetson enqueue failed: ${res.status}`) as Error & { status: number; body: unknown };
    err.status = res.status >= 400 ? res.status : 502;
    err.body = data;
    throw err;
  }
  return data as { id: string; status: string; position?: number };
}

export async function jetsonGetJob(gatewayUrl: string, apiKey: string, jobId: string) {
  const res = await jetsonFetch(gatewayUrl, apiKey, `/jobs/${encodeURIComponent(jobId)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Jetson job status failed: ${res.status}`) as Error & { status: number; body: unknown };
    err.status = 502;
    err.body = data;
    throw err;
  }
  return data as {
    id: string;
    status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
    position?: number;
    progress?: number;
    images?: Array<{ b64_json?: string; url?: string }>;
    error?: string | null;
  };
}

export async function jetsonCancelJob(gatewayUrl: string, apiKey: string, jobId: string) {
  const res = await jetsonFetch(gatewayUrl, apiKey, `/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
  const data = await res.json().catch(() => ({}));
  return data;
}

export async function jetsonHealth(gatewayUrl: string, apiKey: string) {
  const modelsRes = await jetsonFetch(gatewayUrl, apiKey, '/models');
  if (modelsRes.ok) {
    const body = await modelsRes.json().catch(() => ({}));
    return { ok: true, status: modelsRes.status, body };
  }
  const healthRes = await jetsonFetch(gatewayUrl, apiKey, '/health');
  const body = await healthRes.json().catch(() => ({}));
  return { ok: healthRes.ok, status: healthRes.status, body };
}
