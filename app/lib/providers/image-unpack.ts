export function unpackImageItems(data: unknown): any[] {
  if (!data) return [];
  let upstream: any = data;
  if (typeof upstream === 'object' && upstream && 'body' in upstream && (upstream as any).body) {
    upstream = (upstream as any).body;
  }
  if (Array.isArray(upstream)) return upstream;
  if (upstream.data && Array.isArray(upstream.data)) return upstream.data;
  if (upstream.images && Array.isArray(upstream.images)) return upstream.images;
  if (upstream.b64_json || upstream.url || upstream.image) return [upstream];
  if (upstream.result) return Array.isArray(upstream.result) ? upstream.result : [upstream.result];
  return [];
}

export function normalizeB64(value: string): string {
  const idx = value.indexOf('base64,');
  return idx >= 0 ? value.slice(idx + 7) : value;
}

export function snapToMultiple(n: number, m = 16): number {
  if (!Number.isFinite(n) || n <= 0) return m;
  return Math.max(m, Math.round(n / m) * m);
}

export function resolutionBase(resolution: string): number {
  const res = String(resolution || '1k').toLowerCase();
  if (res === '2k' || res === '2048') return 2048;
  if (res === '512' || res === '0.5k' || res === '512px') return 512;
  return 1024;
}

export function aspectToSize(aspect: string, resolution: string): { width: number; height: number } {
  const base = resolutionBase(resolution);
  const map: Record<string, [number, number]> = {
    '1:1': [1, 1],
    '16:9': [16, 9],
    '9:16': [9, 16],
    '4:3': [4, 3],
    '3:4': [3, 4],
    '3:2': [3, 2],
    '2:3': [2, 3],
    '2:1': [2, 1],
    '1:2': [1, 2],
  };
  const [aw, ah] = map[aspect] || [1, 1];
  let width: number;
  let height: number;
  if (aw >= ah) {
    width = base;
    height = (base * ah) / aw;
  } else {
    height = base;
    width = (base * aw) / ah;
  }
  return { width: snapToMultiple(width, 16), height: snapToMultiple(height, 16) };
}

export function formatOpenAISize(width: number, height: number): string {
  return `${snapToMultiple(width, 16)}x${snapToMultiple(height, 16)}`;
}

export function parseOpenAISize(size: string | undefined): { width: number; height: number } | null {
  const m = String(size || '').match(/^(\d+)\s*x\s*(\d+)$/i);
  if (!m) return null;
  return { width: snapToMultiple(Number(m[1]), 16), height: snapToMultiple(Number(m[2]), 16) };
}

export function withSdCppExtraArgs(
  prompt: string,
  extra: { seed?: number | string | null; steps?: number | string | null }
): string {
  if (!prompt) prompt = '';
  if (prompt.includes('<sd_cpp_extra_args>')) return prompt;
  const payload: Record<string, number> = {};
  if (extra.steps != null && extra.steps !== '') {
    const steps = Number(extra.steps);
    if (!Number.isNaN(steps)) payload.steps = Math.min(9, Math.max(0, Math.round(steps)));
  }
  if (extra.seed != null && extra.seed !== '') {
    const seed = Number(extra.seed);
    if (!Number.isNaN(seed)) payload.seed = Math.round(seed);
  }
  if (Object.keys(payload).length === 0) return prompt;
  return `${prompt}<sd_cpp_extra_args>${JSON.stringify(payload)}</sd_cpp_extra_args>`;
}
