export const ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4'] as const;

export const RESOLUTIONS = [
  { id: '512', label: '512', hint: '更快，适合本地模型' },
  { id: '1k', label: '1K', hint: '默认，各家基本都认' },
  { id: '2k', label: '2K', hint: '更清晰，看当前模型支不支持' },
] as const;

export const GEN_COUNTS = ['1', '2', '4'] as const;

export type ResolutionId = (typeof RESOLUTIONS)[number]['id'];

export function normalizeResolution(value: string | undefined | null): ResolutionId {
  const v = String(value || '1k').toLowerCase();
  if (v === '512' || v === '0.5k' || v === '512px') return '512';
  if (v === '2k' || v === '2048') return '2k';
  return '1k';
}
