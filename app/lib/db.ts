import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdirSync, existsSync, unlinkSync } from 'fs';
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
    db.pragma('foreign_keys = ON');
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
      last_message_at TEXT NOT NULL,
      summary TEXT,
      summary_updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      extra_json TEXT,
      status TEXT DEFAULT 'completed',
      error_message TEXT,
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
      status TEXT DEFAULT 'completed',
      error_message TEXT,
      job_id TEXT,
      extra_json TEXT,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_image_id) REFERENCES images(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS vendors (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      label TEXT NOT NULL,
      base_url TEXT NOT NULL DEFAULT '',
      api_key TEXT NOT NULL DEFAULT '',
      extra_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS vendor_models (
      id TEXT PRIMARY KEY,
      vendor_id TEXT NOT NULL,
      model TEXT NOT NULL,
      capabilities TEXT NOT NULL,
      extra_json TEXT,
      FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS capability_bindings (
      capability TEXT PRIMARY KEY,
      vendor_id TEXT NOT NULL,
      model TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_images_conv ON images(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_vendor_models ON vendor_models(vendor_id);
  `);

  // Migration: add status columns if not exist (for existing DBs)
  try {
    const msgCols = db.prepare("PRAGMA table_info(messages)").all() as any[];
    if (!msgCols.some(c => c.name === 'status')) {
      db.exec("ALTER TABLE messages ADD COLUMN status TEXT DEFAULT 'completed'");
    }
    if (!msgCols.some(c => c.name === 'error_message')) {
      db.exec("ALTER TABLE messages ADD COLUMN error_message TEXT");
    }
    const imgCols = db.prepare("PRAGMA table_info(images)").all() as any[];
    if (!imgCols.some(c => c.name === 'status')) {
      db.exec("ALTER TABLE images ADD COLUMN status TEXT DEFAULT 'completed'");
    }
    if (!imgCols.some(c => c.name === 'error_message')) {
      db.exec("ALTER TABLE images ADD COLUMN error_message TEXT");
    }
    if (!imgCols.some(c => c.name === 'job_id')) {
      db.exec('ALTER TABLE images ADD COLUMN job_id TEXT');
    }
    if (!imgCols.some(c => c.name === 'extra_json')) {
      db.exec('ALTER TABLE images ADD COLUMN extra_json TEXT');
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_images_job ON images(job_id)');
    const convCols = db.prepare("PRAGMA table_info(conversations)").all() as any[];
    if (!convCols.some(c => c.name === 'summary')) {
      db.exec("ALTER TABLE conversations ADD COLUMN summary TEXT");
    }
    if (!convCols.some(c => c.name === 'summary_updated_at')) {
      db.exec("ALTER TABLE conversations ADD COLUMN summary_updated_at TEXT");
    }
  } catch (e) {
    // ignore migration errors
  }
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
export function addMessage(convId: string, role: Message['role'], content: string, extra?: any, status: Message['status'] = 'completed', errorMessage?: string | null) {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const extraJson = extra ? JSON.stringify(extra) : null;
  db.prepare(`
    INSERT INTO messages (id, conversation_id, role, content, created_at, extra_json, status, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, convId, role, content, now, extraJson, status || 'completed', errorMessage || null);
  // update last_message_at
  db.prepare(`UPDATE conversations SET last_message_at = ?, updated_at = ? WHERE id = ?`)
    .run(now, now, convId);
  return { id, conversation_id: convId, role, content, created_at: now, extra_json: extra, status: status || 'completed', error_message: errorMessage || null };
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
function stringifyExtra(extra: ImageAsset['extra_json'] | string | null | undefined): string | null {
  if (extra == null || extra === '') return null;
  return typeof extra === 'string' ? extra : JSON.stringify(extra);
}

function parseImageRow(row: any): ImageAsset | undefined {
  if (!row) return undefined;
  return {
    ...row,
    extra_json: row.extra_json
      ? (typeof row.extra_json === 'string' ? JSON.parse(row.extra_json) : row.extra_json)
      : null,
  };
}

export function addImage(asset: Omit<ImageAsset, 'id' | 'created_at'> & { status?: 'pending' | 'completed' | 'error'; error_message?: string | null }) {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO images (
      id, conversation_id, message_id, kind, prompt, negative_prompt,
      model, aspect_ratio, resolution, quality, n_index, parent_image_id,
      file_path, thumb_path, mime, width, height, sha256, created_at, status, error_message,
      job_id, extra_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    id, asset.conversation_id, asset.message_id, asset.kind, asset.prompt, asset.negative_prompt,
    asset.model, asset.aspect_ratio, asset.resolution, asset.quality, asset.n_index, asset.parent_image_id,
    asset.file_path, asset.thumb_path, asset.mime, asset.width, asset.height, asset.sha256, now,
    asset.status || 'completed', asset.error_message || null,
    asset.job_id || null, stringifyExtra(asset.extra_json)
  );
  return { ...asset, id, created_at: now, extra_json: asset.extra_json || null } as ImageAsset;
}

export function listImages(convId: string) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM images WHERE conversation_id = ? ORDER BY created_at DESC
  `).all(convId) as any[];
  return rows.map(r => parseImageRow(r)!) as ImageAsset[];
}

export function getImage(id: string) {
  const db = getDb();
  return parseImageRow(db.prepare(`SELECT * FROM images WHERE id = ?`).get(id));
}

const IMAGE_UPDATE_FIELDS = new Set([
  'status', 'error_message', 'file_path', 'thumb_path', 'mime', 'width', 'height',
  'sha256', 'job_id', 'extra_json', 'model', 'prompt', 'negative_prompt',
]);

export function updateImage(id: string, updates: Partial<ImageAsset> & { extra_json?: Record<string, any> | string | null }) {
  const db = getDb();
  const fields: string[] = [];
  const values: any[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (!IMAGE_UPDATE_FIELDS.has(key)) continue;
    fields.push(`${key} = ?`);
    if (key === 'extra_json') values.push(stringifyExtra(value as any));
    else values.push(value ?? null);
  }
  if (fields.length === 0) return getImage(id);
  values.push(id);
  db.prepare(`UPDATE images SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getImage(id);
}

export function deleteImage(id: string): boolean {
  const db = getDb();
  const img = db.prepare(`SELECT file_path, thumb_path FROM images WHERE id = ?`).get(id) as { file_path: string; thumb_path: string } | undefined;
  if (!img) return false;

  // Physical delete of files
  try {
    const imgFullPath = join(DATA_DIR, img.file_path);
    const thumbFullPath = join(DATA_DIR, img.thumb_path);
    if (existsSync(imgFullPath)) unlinkSync(imgFullPath);
    if (existsSync(thumbFullPath)) unlinkSync(thumbFullPath);
  } catch (e) {
    console.error('Failed to delete image files:', e);
    // Continue to delete DB record even if file delete fails
  }

  // Delete DB record
  const result = db.prepare(`DELETE FROM images WHERE id = ?`).run(id);
  return result.changes > 0;
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

export function updateMessageStatus(
  messageId: string,
  status: 'pending' | 'completed' | 'error',
  content?: string,
  errorMessage?: string
) {
  const db = getDb();
  const fields: string[] = ['status = ?'];
  const values: any[] = [status];

  if (content !== undefined) {
    fields.push('content = ?');
    values.push(content);
  }
  if (errorMessage !== undefined) {
    fields.push('error_message = ?');
    values.push(errorMessage);
  }

  values.push(messageId);

  db.prepare(`
    UPDATE messages SET ${fields.join(', ')} WHERE id = ?
  `).run(...values);
}

export function updateConversationSummary(convId: string, summary: string) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE conversations 
    SET summary = ?, summary_updated_at = ?, updated_at = ?
    WHERE id = ?
  `).run(summary, now, now, convId);
}

export function getConversationSummary(convId: string): string | null {
  const db = getDb();
  const row = db.prepare(`SELECT summary FROM conversations WHERE id = ?`).get(convId) as any;
  return row?.summary || null;
}
