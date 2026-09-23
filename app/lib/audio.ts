import { createWriteStream, existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { WriteStream } from 'fs';

const DATA_DIR = process.env.DATA_DIR || './data';
const AUDIO_DIR = join(DATA_DIR, 'audio');

export function ensureAudioDir() {
  if (!existsSync(/* turbopackIgnore: true */ AUDIO_DIR)) {
    mkdirSync(/* turbopackIgnore: true */ AUDIO_DIR, { recursive: true });
  }
}

export function messageAudioRelPath(messageId: string) {
  return `audio/${messageId}.wav`;
}

export function messageAudioAbsPath(messageId: string) {
  return join(/* turbopackIgnore: true */ DATA_DIR, messageAudioRelPath(messageId));
}

export function audioFileExists(relPath: string) {
  return existsSync(/* turbopackIgnore: true */ join(/* turbopackIgnore: true */ DATA_DIR, relPath));
}

export function openAudioWrite(messageId: string): { rel: string; abs: string; stream: WriteStream } {
  ensureAudioDir();
  const rel = messageAudioRelPath(messageId);
  const abs = messageAudioAbsPath(messageId);
  return { rel, abs, stream: createWriteStream(/* turbopackIgnore: true */ abs) };
}

export function removeAudioFile(abs: string) {
  try {
    if (existsSync(/* turbopackIgnore: true */ abs)) unlinkSync(/* turbopackIgnore: true */ abs);
  } catch {}
}

export function saveSpeakerPt(vendorId: string, name: string, buf: Buffer): string {
  const dir = join(/* turbopackIgnore: true */ DATA_DIR, 'voices', vendorId);
  if (!existsSync(/* turbopackIgnore: true */ dir)) mkdirSync(/* turbopackIgnore: true */ dir, { recursive: true });
  const rel = `voices/${vendorId}/${name}.pt`;
  writeFileSync(/* turbopackIgnore: true */ join(DATA_DIR, rel), buf);
  return rel;
}

export function speakerPtAbs(rel: string): string {
  return join(/* turbopackIgnore: true */ DATA_DIR, rel);
}
