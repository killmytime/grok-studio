import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import type { Message, ImageAsset } from './types';

const DATA_DIR = process.env.DATA_DIR || './data';
const DB_PATH = join(DATA_DIR, 'grok-studio.db');

let db: Database.Database | null = null;

function ensureDataDir() {
  if (!existsSync(/* turbopackIgnore: true */ DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  const imagesDir = join(DATA_DIR, 'images');
  const thumbsDir = join(DATA_DIR, 'thumbs');
  const uploadsDir = join(DATA_DIR, 'uploads');
  [imagesDir, thumbsDir, uploadsDir].forEach(dir => {
    if (!existsSync(/* turbopackIgnore: true */ dir)) mkdirSync(dir, { recursive: true });
  });
}

export function getDb() {
  if (!db) {
    ensureDataDir();
    db = new Database(/* turbopackIgnore: true */ DB_PATH);
    db.pragma('journal_mode = WAL');
    initSchema(db);
  }
  return db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_message_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      extra_json TEXT,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS images (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      message_id TEXT,
      kind TEXT NOT NULL CHECK(kind IN ('generate','edit','upload')),
      prompt TEXT NOT NULL,
      negative_prompt TEXT,
      model TEXT NOT NULL,
      aspect_ratio TEXT NOT NULL,
      resolution TEXT NOT NULL,
      quality TEXT,
      n_index INTEGER NOT NULL DEFAULT 1,
      parent_image_id TEXT,
      file_path TEXT NOT NULL,
      thumb_path TEXT NOT NULL,
      mime TEXT NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_image_id) REFERENCES images(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_images_conv ON images(conversation_id, created_at);
  `);
}

// Conversations
export function createConversation(title: string) {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO conversations (id, title, created_at, updated_at, last_message_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(id, title, now, now, now);
  return { id, title, created_at: now, updated_at: now, last_message_at: now };
}

export function listConversations() {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM conversations ORDER BY last_message_at DESC
  `).all() as any[];
}

export function getConversation(id: string) {
  const db = getDb();
  return db.prepare(`SELECT * FROM conversations WHERE id = ?`).get(id) as any;
}

export function updateConversation(id: string, updates: Partial<{ title: string; last_message_at: string }>) {
  const db = getDb();
  const now = new Date().toISOString();
  const fields = Object.keys(updates);
  if (fields.length === 0) return;
  const setClause = fields.map(f => `${f} = ?`).join(', ');
  const values = [...Object.values(updates), now, id];
  db.prepare(`UPDATE conversations SET ${setClause}, updated_at = ? WHERE id = ?`).run(...values);
}

export function deleteConversation(id: string) {
  const db = getDb();
  db.prepare(`DELETE FROM conversations WHERE id = ?`).run(id);
}

// Messages
export function addMessage(convId: string, role: Message['role'], content: string, extra?: any) {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const extraJson = extra ? JSON.stringify(extra) : null;
  db.prepare(`
    INSERT INTO messages (id, conversation_id, role, content, created_at, extra_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, convId, role, content, now, extraJson);
  // update last_message_at
  db.prepare(`UPDATE conversations SET last_message_at = ?, updated_at = ? WHERE id = ?`)
    .run(now, now, convId);
  return { id, conversation_id: convId, role, content, created_at: now, extra_json: extra };
}

export function listMessages(convId: string) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC
  `).all(convId) as any[];
  return rows.map(r => ({
    ...r,
    extra_json: r.extra_json ? JSON.parse(r.extra_json) : null
  }));
}

// Images
export function addImage(asset: Omit<ImageAsset, 'id' | 'created_at'>) {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO images (
      id, conversation_id, message_id, kind, prompt, negative_prompt,
      model, aspect_ratio, resolution, quality, n_index, parent_image_id,
      file_path, thumb_path, mime, width, height, sha256, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    id, asset.conversation_id, asset.message_id, asset.kind, asset.prompt, asset.negative_prompt,
    asset.model, asset.aspect_ratio, asset.resolution, asset.quality, asset.n_index, asset.parent_image_id,
    asset.file_path, asset.thumb_path, asset.mime, asset.width, asset.height, asset.sha256, now
  );
  return { ...asset, id, created_at: now } as ImageAsset;
}

export function listImages(convId: string) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM images WHERE conversation_id = ? ORDER BY created_at DESC
  `).all(convId) as ImageAsset[];
}

export function getImage(id: string) {
  const db = getDb();
  return db.prepare(`SELECT * FROM images WHERE id = ?`).get(id) as ImageAsset | undefined;
}

// Settings
export function getSetting(key: string, defaultValue: string = ''): string {
  const db = getDb();
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as any;
  return row ? row.value : defaultValue;
}

export function setSetting(key: string, value: string) {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)
  `).run(key, value);
}

export function getAllSettings(): Record<string, string> {
  const db = getDb();
  const rows = db.prepare(`SELECT key, value FROM settings`).all() as { key: string; value: string }[];
  const settings: Record<string, string> = {};
  rows.forEach(r => settings[r.key] = r.value);
  return settings;
}
