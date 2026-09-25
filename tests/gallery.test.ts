/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import Database from 'better-sqlite3';
import { vi } from 'vitest';

const TEST_DATA_DIR = join(process.cwd(), 'tests', '.tmp-gallery');
process.env.DATA_DIR = TEST_DATA_DIR;
if (existsSync(TEST_DATA_DIR)) rmSync(TEST_DATA_DIR, { recursive: true, force: true });
mkdirSync(TEST_DATA_DIR, { recursive: true });

function stubImage(convId: string, prompt: string, kind: 'generate' | 'edit' | 'upload' = 'generate') {
  return {
    conversation_id: convId,
    message_id: null,
    kind,
    prompt,
    negative_prompt: null,
    model: 'grok-imagine-image-2.0',
    aspect_ratio: '1:1',
    resolution: '1k',
    quality: null,
    n_index: 0,
    parent_image_id: null,
    file_path: `images/${prompt.slice(0, 8)}.png`,
    thumb_path: `thumbs/${prompt.slice(0, 8)}.jpg`,
    mime: 'image/png',
    width: 1024,
    height: 1024,
    sha256: prompt,
    status: 'completed' as const,
  };
}

describe('gallery listing', () => {
  let db: any;
  let imagesRoute: any;
  let imagesLib: any;
  let a: any;
  let b: any;

  beforeAll(async () => {
    vi.resetModules();
    process.env.DATA_DIR = TEST_DATA_DIR;
    db = await import('../app/lib/db');
    imagesRoute = await import('../app/api/images/route');
    imagesLib = await import('../app/lib/image');
    a = db.createConversation('地铁拥挤');
    b = db.createConversation('操场体测');
    db.addImage(stubImage(a.id, 'red silk shirt', 'generate'));
    db.addImage(stubImage(a.id, 'edit the lighting', 'edit'));
    db.addImage(stubImage(b.id, 'rain on the field', 'generate'));
    db.addImage({ ...stubImage(b.id, 'broken render'), status: 'error', error_message: 'nope' });
  });

  afterAll(() => {
    if (existsSync(TEST_DATA_DIR)) {
      try { rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch {}
    }
  });

  it('GET /api/images returns completed works with conversation titles', async () => {
    const res = await imagesRoute.GET(new Request('http://localhost/api/images'));
    const data = await res.json();
    expect(data.total).toBe(3);
    expect(data.images).toHaveLength(3);
    expect(data.images.every((img: any) => img.status === 'completed' || img.status == null)).toBe(true);
    expect(data.images.some((img: any) => img.conversation_title === '地铁拥挤')).toBe(true);
    expect(data.images.some((img: any) => img.conversation_title === '操场体测')).toBe(true);
  });

  it('filters by kind, conversation, and prompt/title search', async () => {
    const byKind = await (await imagesRoute.GET(new Request('http://localhost/api/images?kind=edit'))).json();
    expect(byKind.total).toBe(1);
    expect(byKind.images[0].prompt).toBe('edit the lighting');

    const byConv = await (await imagesRoute.GET(new Request(`http://localhost/api/images?conversation_id=${a.id}`))).json();
    expect(byConv.total).toBe(2);

    const byQ = await (await imagesRoute.GET(new Request('http://localhost/api/images?q=操场'))).json();
    expect(byQ.total).toBe(1);
    expect(byQ.images[0].prompt).toBe('rain on the field');
  });

  it('status=all includes errors', async () => {
    const data = await (await imagesRoute.GET(new Request('http://localhost/api/images?status=all'))).json();
    expect(data.total).toBe(4);
    expect(data.images.some((img: any) => img.status === 'error')).toBe(true);
  });

  it('paginates with limit and offset', async () => {
    const page1 = await (await imagesRoute.GET(new Request('http://localhost/api/images?status=all&limit=2&offset=0'))).json();
    const page2 = await (await imagesRoute.GET(new Request('http://localhost/api/images?status=all&limit=2&offset=2'))).json();
    expect(page1.total).toBe(4);
    expect(page1.images).toHaveLength(2);
    expect(page2.images).toHaveLength(2);
    const ids = [...page1.images, ...page2.images].map((img: any) => img.id);
    expect(new Set(ids).size).toBe(4);
  });

  it('keeps the image row when its conversation is deleted', async () => {
    const conv = db.createConversation('会被删掉');
    const img = db.addImage(stubImage(conv.id, 'keep after delete'));
    db.deleteConversation(conv.id);
    expect(db.getConversation(conv.id)).toBeFalsy();
    const row = db.getImage(img.id);
    expect(row.conversation_id).toBeNull();
    expect(row.prompt).toBe('keep after delete');

    const listed = await (await imagesRoute.GET(new Request('http://localhost/api/images?conversation_id=__none__'))).json();
    const found = listed.images.find((item: any) => item.id === img.id);
    expect(found).toBeTruthy();
    expect(found.conversation_title).toBeNull();
  });

  it('registers image files that lost their row', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );
    writeFileSync(join(TEST_DATA_DIR, 'images', 'loose-orphan.png'), png);
    const added = await imagesLib.importOrphanImageFiles();
    expect(added).toBe(1);
    expect(await imagesLib.importOrphanImageFiles()).toBe(0);
    const listed = await (await imagesRoute.GET(new Request('http://localhost/api/images?conversation_id=__none__'))).json();
    const found = listed.images.find((item: any) => item.file_path === 'images/loose-orphan.png');
    expect(found.conversation_id).toBeNull();
    expect(found.prompt).toBe('');
    expect(found.extra_json.recovered).toBe(true);
    expect(found.thumb_path).toBe('thumbs/loose-orphan.jpg');
  });

  it('rewrites an old cascade foreign key so deletes detach images', () => {
    const mem = new Database(':memory:');
    mem.exec(`
      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL
      );
      CREATE TABLE images (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        message_id TEXT,
        kind TEXT NOT NULL,
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
        status TEXT,
        error_message TEXT,
        job_id TEXT,
        extra_json TEXT,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );
    `);
    mem.prepare(`INSERT INTO conversations (id, title) VALUES ('c1', 'old')`).run();
    mem.prepare(`
      INSERT INTO images (
        id, conversation_id, message_id, kind, prompt, negative_prompt, model, aspect_ratio, resolution,
        quality, n_index, parent_image_id, file_path, thumb_path, mime, width, height, sha256, created_at
      ) VALUES ('i1', 'c1', NULL, 'generate', 'old prompt', NULL, 'grok', '1:1', '1k', NULL, 1, NULL,
        'images/old.png', 'thumbs/old.jpg', 'image/png', 8, 8, 'abc', '2020-01-01T00:00:00.000Z')
    `).run();
    mem.pragma('foreign_keys = ON');
    db.migrateImagesKeepAfterConversationDelete(mem);
    mem.prepare(`DELETE FROM conversations WHERE id = 'c1'`).run();
    const row = mem.prepare(`SELECT conversation_id, prompt, file_path FROM images WHERE id = 'i1'`).get() as any;
    expect(row.conversation_id).toBeNull();
    expect(row.prompt).toBe('old prompt');
    expect(row.file_path).toBe('images/old.png');
    const fk = (mem.prepare(`PRAGMA foreign_key_list(images)`).all() as any[]).find((item) => item.from === 'conversation_id');
    expect(String(fk.on_delete).toUpperCase()).toBe('SET NULL');
    expect(fk.table).toBe('conversations');
    mem.close();
  });
});
