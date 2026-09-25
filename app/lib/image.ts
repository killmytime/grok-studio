import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import sharp from 'sharp';
import crypto from 'crypto';
import { addImage, getDb, updateImage, getImage } from './db';
import { nearestAspect, resolutionFromPixels } from './image-presets';
import type { ImageAsset } from './types';

const DATA_DIR = process.env.DATA_DIR || './data';
const IMAGES_DIR = join(DATA_DIR, 'images');
const THUMBS_DIR = join(DATA_DIR, 'thumbs');

function ensureDirs() {
  [IMAGES_DIR, THUMBS_DIR].forEach(d => {
    if (!existsSync(/* turbopackIgnore: true */ d)) mkdirSync(d, { recursive: true });
  });
}

export function computeSha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export async function saveImageFromUrl(
  url: string,
  convId: string,
  prompt: string,
  model: string,
  aspect: string,
  resolution: string,
  kind: ImageAsset['kind'] = 'generate',
  parentId?: string,
  messageId?: string
): Promise<ImageAsset> {
  ensureDirs();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  return saveImageBuffer(buffer, convId, prompt, model, aspect, resolution, kind, parentId, messageId, 'image/png');
}

export async function saveImageFromBase64(
  b64: string,
  convId: string,
  prompt: string,
  model: string,
  aspect: string,
  resolution: string,
  kind: ImageAsset['kind'] = 'generate',
  parentId?: string,
  messageId?: string,
  mime = 'image/png'
): Promise<ImageAsset> {
  ensureDirs();
  const buffer = Buffer.from(b64, 'base64');
  return saveImageBuffer(buffer, convId, prompt, model, aspect, resolution, kind, parentId, messageId, mime);
}

async function writeImageFiles(buffer: Buffer, mime = 'image/png') {
  ensureDirs();
  const sha = computeSha256(buffer);
  const ext = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : 'png';
  const filename = `${sha.slice(0, 16)}.${ext}`;
  const filePath = join(IMAGES_DIR, filename);
  const thumbPath = join(THUMBS_DIR, `${sha.slice(0, 16)}.jpg`);

  if (!existsSync(filePath)) {
    writeFileSync(filePath, buffer);
  }

  const thumbBuffer = await sharp(buffer)
    .resize(320, 320, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
  writeFileSync(thumbPath, thumbBuffer);

  const meta = await sharp(buffer).metadata();
  return {
    sha256: sha,
    mime,
    file_path: `images/${filename}`,
    thumb_path: `thumbs/${sha.slice(0, 16)}.jpg`,
    width: meta.width || 1024,
    height: meta.height || 1024,
  };
}

async function saveImageBuffer(
  buffer: Buffer,
  convId: string,
  prompt: string,
  model: string,
  aspect: string,
  resolution: string,
  kind: ImageAsset['kind'],
  parentId?: string,
  messageId?: string,
  mime = 'image/png'
): Promise<ImageAsset> {
  const files = await writeImageFiles(buffer, mime);

  const asset: Omit<ImageAsset, 'id' | 'created_at'> = {
    conversation_id: convId,
    message_id: messageId || null,
    kind,
    prompt,
    negative_prompt: null,
    model,
    aspect_ratio: aspect,
    resolution,
    quality: null,
    n_index: 1,
    parent_image_id: parentId || null,
    file_path: files.file_path,
    thumb_path: files.thumb_path,
    mime: files.mime,
    width: files.width,
    height: files.height,
    sha256: files.sha256,
    status: 'completed',
  };

  return addImage(asset);
}

export async function finalizePendingImage(
  imageId: string,
  buffer: Buffer,
  mime = 'image/png'
): Promise<ImageAsset> {
  const files = await writeImageFiles(buffer, mime);
  const updated = updateImage(imageId, {
    ...files,
    status: 'completed',
    error_message: null,
  });
  if (!updated) throw new Error('Image not found');
  return updated;
}

export async function finalizePendingImageFromBase64(imageId: string, b64: string, mime = 'image/png'): Promise<ImageAsset> {
  const raw = b64.includes('base64,') ? b64.slice(b64.indexOf('base64,') + 7) : b64;
  return finalizePendingImage(imageId, Buffer.from(raw, 'base64'), mime);
}

export async function finalizePendingImageFromUrl(imageId: string, url: string): Promise<ImageAsset> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const mime = res.headers.get('content-type') || 'image/png';
  return finalizePendingImage(imageId, buffer, mime.includes('jpeg') ? 'image/jpeg' : 'image/png');
}

export function getPendingImage(id: string): ImageAsset | undefined {
  return getImage(id);
}

export function getImageFilePath(relative: string): string {
  return join(/* turbopackIgnore: true */ DATA_DIR, relative);
}

let adoptedOrphans: Promise<number> | null = null;

/** Files left behind when a conversation delete used to drop the image row. */
export async function importOrphanImageFiles(): Promise<number> {
  ensureDirs();
  const known = new Set(
    (getDb().prepare(`SELECT file_path FROM images`).all() as { file_path: string }[]).map((row) => row.file_path)
  );
  let added = 0;
  let names: string[] = [];
  try {
    names = readdirSync(/* turbopackIgnore: true */ IMAGES_DIR);
  } catch {
    return 0;
  }
  for (const name of names) {
    if (!/\.(png|jpe?g|webp)$/i.test(name)) continue;
    const relative = `images/${name}`;
    if (known.has(relative)) continue;
    const full = join(IMAGES_DIR, name);
    try {
      const buffer = readFileSync(/* turbopackIgnore: true */ full);
      const meta = await sharp(buffer).metadata();
      const width = meta.width || 0;
      const height = meta.height || 0;
      if (!width || !height) continue;
      const mime = meta.format === 'jpeg' ? 'image/jpeg' : meta.format === 'webp' ? 'image/webp' : 'image/png';
      const created = statSync(/* turbopackIgnore: true */ full).mtime.toISOString();
      const stem = name.replace(/\.[^.]+$/, '');
      const thumbRelative = `thumbs/${stem}.jpg`;
      const thumbFull = join(THUMBS_DIR, `${stem}.jpg`);
      if (!existsSync(/* turbopackIgnore: true */ thumbFull)) {
        const thumbBuffer = await sharp(buffer)
          .resize(320, 320, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toBuffer();
        writeFileSync(thumbFull, thumbBuffer);
      }
      const asset = addImage({
        conversation_id: null,
        message_id: null,
        kind: 'generate',
        prompt: '',
        negative_prompt: null,
        model: '',
        aspect_ratio: nearestAspect(width, height),
        resolution: resolutionFromPixels(width, height),
        quality: null,
        n_index: 1,
        parent_image_id: null,
        file_path: relative,
        thumb_path: thumbRelative,
        mime,
        width,
        height,
        sha256: computeSha256(buffer),
        status: 'completed',
        extra_json: { source: 'orphan-file', recovered: true },
      });
      getDb().prepare(`UPDATE images SET created_at = ? WHERE id = ?`).run(created, asset.id);
      known.add(relative);
      added++;
    } catch (e) {
      console.error('orphan image', name, e);
    }
  }
  return added;
}

export function adoptOrphanImageFiles(): Promise<number> {
  if (!adoptedOrphans) {
    adoptedOrphans = importOrphanImageFiles().catch((err) => {
      adoptedOrphans = null;
      throw err;
    });
  }
  return adoptedOrphans;
}

export async function imageToDataUri(filePath: string): Promise<string> {
  const full = getImageFilePath(filePath);
  if (!existsSync(/* turbopackIgnore: true */ full)) throw new Error('Image not found');
  const buffer = readFileSync(/* turbopackIgnore: true */ full);
  const mime = filePath.endsWith('.jpg') || filePath.endsWith('.jpeg') ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${buffer.toString('base64')}`;
}
