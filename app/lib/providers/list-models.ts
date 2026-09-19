import { bearerHeaders, normalizeChatBaseUrl, normalizeImagenBaseUrl } from '../backends';
import { canonicalIntegrationId, getIntegration, type Capability } from '../integrations/catalog';

export interface RemoteModel {
  id: string;
  suggested: Capability[];
}

export function modelsBaseUrl(kind: string, raw: string): string {
  const k = canonicalIntegrationId(kind);
  const trimmed = (raw || '').replace(/\/+$/, '');
  if (!trimmed) return '';
  if (k === 'imagen') return normalizeImagenBaseUrl(trimmed);
  if (k === 'ollama') return normalizeChatBaseUrl(trimmed, 'ollama');
  if (/\/v1$/i.test(trimmed)) return trimmed;
  return trimmed;
}

export function guessModelCapabilities(kind: string, modelId: string): Capability[] {
  const integration = getIntegration(kind);
  const allowed = new Set(integration.capabilities);
  const id = modelId.toLowerCase();
  let guessed: Capability[];
  if (integration.id === 'imagen') guessed = ['image.generate'];
  else if (integration.id === 'ollama') guessed = ['chat'];
  else if (/imagine|image|dall|flux|sd-|diffusion|turbo/.test(id) && !/chat|instruct|latest$/.test(id)) {
    guessed = ['image.generate', 'image.edit'];
  } else {
    guessed = ['chat'];
  }
  return guessed.filter((c) => allowed.has(c));
}

function collectIds(data: any): string[] {
  if (!data) return [];
  const rows = Array.isArray(data)
    ? data
    : Array.isArray(data.data)
      ? data.data
      : Array.isArray(data.models)
        ? data.models
        : [];
  const ids = rows.map((row: any) => {
    if (typeof row === 'string') return row;
    return row?.id || row?.name || row?.model || '';
  }).filter(Boolean);
  return [...new Set(ids as string[])];
}

export async function listRemoteModels(opts: {
  kind: string;
  baseUrl: string;
  apiKey?: string;
}): Promise<{ models: RemoteModel[]; endpoint: string }> {
  const kind = canonicalIntegrationId(opts.kind);
  const base = modelsBaseUrl(kind, opts.baseUrl);
  if (!base) {
    const err = new Error('供应商 URL 未填写') as Error & { status: number };
    err.status = 400;
    throw err;
  }
  const headers = bearerHeaders(opts.apiKey || '');
  const endpoint = `${base}/models`;
  let res = await fetch(endpoint, { headers });
  let data = await res.json().catch(() => ({}));

  if (!res.ok && kind === 'ollama') {
    const root = base.replace(/\/v1$/i, '');
    const tags = await fetch(`${root}/api/tags`);
    if (tags.ok) {
      data = await tags.json().catch(() => ({}));
      res = tags;
    }
  }

  if (!res.ok) {
    const err = new Error(data.error?.message || data.error || `拉取模型失败: ${res.status}`) as Error & {
      status: number;
      body: unknown;
    };
    err.status = 502;
    err.body = data;
    throw err;
  }

  const ids = collectIds(data);
  return {
    endpoint,
    models: ids.map((id) => ({ id, suggested: guessModelCapabilities(kind, id) })),
  };
}
