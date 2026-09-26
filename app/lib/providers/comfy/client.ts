import { comfyRoot } from '../../backends';

export class ComfyError extends Error {
  status: number;
  body?: unknown;
  constructor(message: string, status = 502, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export interface ComfyImageRef {
  filename: string;
  subfolder: string;
  type: string;
}

function authHeaders(apiKey: string, json = false): Record<string, string> {
  const headers: Record<string, string> = {};
  if (json) headers['Content-Type'] = 'application/json';
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

function rootOrThrow(baseUrl: string): string {
  const root = comfyRoot(baseUrl);
  if (!root) throw new ComfyError('ComfyUI 地址未配置', 400);
  return root;
}

async function readJson(res: Response): Promise<any> {
  return res.json().catch(() => ({}));
}

export function formatNodeErrors(nodeErrors: unknown): string {
  if (!nodeErrors || typeof nodeErrors !== 'object') return '';
  const parts: string[] = [];
  for (const [id, err] of Object.entries(nodeErrors as Record<string, any>)) {
    const errors = Array.isArray(err?.errors) ? err.errors : [];
    const msg = errors.map((e: any) => e?.message || e?.details || '').filter(Boolean).join('; ');
    const cls = err?.class_type ? ` (${err.class_type})` : '';
    parts.push(`节点 ${id}${cls}: ${msg || '无效'}`);
  }
  return parts.join(' ');
}

export function historyErrorMessage(entry: any): string {
  const status = entry?.status;
  if (status?.status_str !== 'error') return '';
  const messages = Array.isArray(status.messages) ? status.messages : [];
  for (const message of messages) {
    if (Array.isArray(message) && message[0] === 'execution_error') {
      return message[1]?.exception_message || 'ComfyUI 执行失败';
    }
  }
  return 'ComfyUI 执行失败';
}

export function collectOutputImages(entry: any): ComfyImageRef[] {
  const images: ComfyImageRef[] = [];
  const outputs = entry?.outputs || {};
  for (const node of Object.values(outputs) as any[]) {
    for (const img of node?.images || []) {
      if (!img?.filename) continue;
      images.push({
        filename: String(img.filename),
        subfolder: String(img.subfolder || ''),
        type: String(img.type || 'output'),
      });
    }
  }
  return images;
}

export async function comfyHealth(baseUrl: string, apiKey: string): Promise<{ ok: boolean; status: number; body: unknown }> {
  const root = comfyRoot(baseUrl);
  if (!root) return { ok: false, status: 400, body: { error: 'ComfyUI 地址未配置' } };
  try {
    const res = await fetch(`${root}/system_stats`, { headers: authHeaders(apiKey) });
    const body = await readJson(res);
    return { ok: res.ok, status: res.status, body };
  } catch (e: any) {
    return { ok: false, status: 502, body: { error: e?.message || '无法连接 ComfyUI' } };
  }
}

export async function listUnets(baseUrl: string, apiKey: string): Promise<string[]> {
  const root = rootOrThrow(baseUrl);
  const res = await fetch(`${root}/models/unet`, { headers: authHeaders(apiKey) });
  const data = await readJson(res);
  if (!res.ok) {
    throw new ComfyError(data?.error || `拉取 UNet 失败: ${res.status}`, 502, data);
  }
  if (Array.isArray(data)) return data.map((row) => String(row)).filter(Boolean);
  return [];
}

export async function submitPrompt(baseUrl: string, apiKey: string, graph: unknown): Promise<string> {
  const root = rootOrThrow(baseUrl);
  let res: Response;
  try {
    res = await fetch(`${root}/prompt`, {
      method: 'POST',
      headers: authHeaders(apiKey, true),
      body: JSON.stringify({ prompt: graph, client_id: 'grok-studio' }),
    });
  } catch (e: any) {
    throw new ComfyError(e?.message || `无法连接 ComfyUI（${root}）`, 502);
  }
  const data = await readJson(res);
  const nodeErrors = data?.node_errors;
  const hasNodeErrors = nodeErrors && typeof nodeErrors === 'object' && Object.keys(nodeErrors).length > 0;
  if (!res.ok || hasNodeErrors) {
    const detail = formatNodeErrors(nodeErrors) || data?.error?.message || data?.error || `ComfyUI /prompt 失败: ${res.status}`;
    throw new ComfyError(String(detail), 502, data);
  }
  if (!data?.prompt_id) throw new ComfyError('ComfyUI 没有返回 prompt_id', 502, data);
  return String(data.prompt_id);
}

export async function getHistoryEntry(baseUrl: string, apiKey: string, promptId: string): Promise<any | null> {
  const root = rootOrThrow(baseUrl);
  const res = await fetch(`${root}/history/${encodeURIComponent(promptId)}`, { headers: authHeaders(apiKey) });
  if (res.status === 404) return null;
  const data = await readJson(res);
  if (!res.ok) throw new ComfyError(data?.error || `读取 ComfyUI 历史失败: ${res.status}`, 502, data);
  return data?.[promptId] || null;
}

export async function fetchView(baseUrl: string, apiKey: string, image: ComfyImageRef): Promise<Buffer> {
  const root = rootOrThrow(baseUrl);
  const q = new URLSearchParams({
    filename: image.filename,
    subfolder: image.subfolder,
    type: image.type,
  });
  const res = await fetch(`${root}/view?${q}`, { headers: authHeaders(apiKey) });
  if (!res.ok) throw new ComfyError(`下载图像失败: ${res.status}`, 502);
  return Buffer.from(await res.arrayBuffer());
}

export async function uploadImage(baseUrl: string, apiKey: string, bytes: Buffer, filename: string, mime: string): Promise<string> {
  const root = rootOrThrow(baseUrl);
  const body = new FormData();
  body.set('image', new Blob([new Uint8Array(bytes)], { type: mime }), filename);
  body.set('overwrite', 'true');
  body.set('type', 'input');
  let res: Response;
  try {
    res = await fetch(`${root}/upload/image`, { method: 'POST', headers: authHeaders(apiKey), body });
  } catch (e: any) {
    throw new ComfyError(e?.message || `无法连接 ComfyUI（${root}）`, 502);
  }
  const data = await readJson(res);
  if (!res.ok || !data?.name) {
    throw new ComfyError(data?.error || `上传参考图失败: ${res.status}`, 502, data);
  }
  const name = String(data.name);
  const sub = String(data.subfolder || '');
  return sub ? `${sub}/${name}` : name;
}

export function runningPromptId(queue: any): string | null {
  const item = queue?.queue_running?.[0];
  if (!Array.isArray(item)) return null;
  return typeof item[1] === 'string' ? item[1] : null;
}

export async function cancelQueuedPrompt(baseUrl: string, apiKey: string, promptId: string): Promise<void> {
  const root = comfyRoot(baseUrl);
  if (!root || !promptId) return;
  await fetch(`${root}/queue`, {
    method: 'POST',
    headers: authHeaders(apiKey, true),
    body: JSON.stringify({ delete: [promptId] }),
  }).catch(() => undefined);
  const res = await fetch(`${root}/queue`, { headers: authHeaders(apiKey) }).catch(() => null);
  if (!res?.ok) return;
  const queue = await res.json().catch(() => ({}));
  if (runningPromptId(queue) === promptId) {
    await fetch(`${root}/interrupt`, { method: 'POST', headers: authHeaders(apiKey) }).catch(() => undefined);
  }
}
