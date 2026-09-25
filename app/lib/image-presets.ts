export const ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4'] as const;

export const RESOLUTIONS = [
  { id: '512', label: '512', hint: '更快，适合本地模型' },
  { id: '1k', label: '1K', hint: '默认，各家基本都认' },
  { id: '2k', label: '2K', hint: '更清晰，看当前模型支不支持' },
] as const;

export const GEN_COUNTS = ['1', '2', '4'] as const;

export type ResolutionId = (typeof RESOLUTIONS)[number]['id'];

const ASPECT_VALUES: Array<[string, number]> = [
  ['1:1', 1],
  ['16:9', 16 / 9],
  ['9:16', 9 / 16],
  ['4:3', 4 / 3],
  ['3:4', 3 / 4],
  ['3:2', 3 / 2],
  ['2:3', 2 / 3],
];

export function nearestAspect(width: number, height: number): string {
  if (!width || !height) return '1:1';
  const ratio = width / height;
  let best = '1:1';
  let bestDiff = Infinity;
  for (const [label, value] of ASPECT_VALUES) {
    const diff = Math.abs(Math.log(ratio / value));
    if (diff < bestDiff) {
      best = label;
      bestDiff = diff;
    }
  }
  return best;
}

export function resolutionFromPixels(width: number, height: number): ResolutionId {
  const max = Math.max(width || 0, height || 0);
  if (max <= 640) return '512';
  if (max <= 1400) return '1k';
  return '2k';
}

export function normalizeResolution(value: string | undefined | null): ResolutionId {
  const v = String(value || '1k').toLowerCase();
  if (v === '512' || v === '0.5k' || v === '512px') return '512';
  if (v === '2k' || v === '2048') return '2k';
  return '1k';
}
