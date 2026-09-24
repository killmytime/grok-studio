/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { existsSync, mkdirSync, rmSync } from 'fs';
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
  let a: any;
  let b: any;

  beforeAll(async () => {
    vi.resetModules();
    process.env.DATA_DIR = TEST_DATA_DIR;
    db = await import('../app/lib/db');
    imagesRoute = await import('../app/api/images/route');
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
});
