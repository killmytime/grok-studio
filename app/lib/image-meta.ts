import { getImage, updateImage } from './db';
import type { ImageAsset } from './types';

export function mergeImageMeta(id: string, extra: Record<string, unknown>): ImageAsset | undefined {
  const img = getImage(id);
  if (!img) return undefined;
  return updateImage(id, { extra_json: { ...(img.extra_json || {}), ...extra } }) || img;
}
