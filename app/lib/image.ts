import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join, extname } from 'path';
import sharp from 'sharp';
import crypto from 'crypto';
import { getDb, addImage } from './db';
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
  ensureDirs();
  const sha = computeSha256(buffer);
  const ext = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : 'png';
  const filename = `${sha.slice(0, 16)}.${ext}`;
  const filePath = join(IMAGES_DIR, filename);
  const thumbPath = join(THUMBS_DIR, `${sha.slice(0, 16)}.jpg`);

  if (!existsSync(filePath)) {
    writeFileSync(filePath, buffer);
  }

  // Generate thumbnail
  const thumbBuffer = await sharp(buffer)
    .resize(320, 320, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
  writeFileSync(thumbPath, thumbBuffer);

  // Get dimensions
  const meta = await sharp(buffer).metadata();

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
    file_path: `images/${filename}`,
    thumb_path: `thumbs/${sha.slice(0, 16)}.jpg`,
    mime,
    width: meta.width || 1024,
    height: meta.height || 1024,
    sha256: sha,
  };

  return addImage(asset);
}

export function getImageFilePath(relative: string): string {
  return join(/* turbopackIgnore: true */ DATA_DIR, relative);
}

export async function imageToDataUri(filePath: string): Promise<string> {
  const full = getImageFilePath(filePath);
  if (!existsSync(/* turbopackIgnore: true */ full)) throw new Error('Image not found');
  const buffer = readFileSync(/* turbopackIgnore: true */ full);
  const mime = filePath.endsWith('.jpg') || filePath.endsWith('.jpeg') ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${buffer.toString('base64')}`;
}
