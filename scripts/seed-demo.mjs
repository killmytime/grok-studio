#!/usr/bin/env node
/**
 * Seeds docs/demo-data only. Refuses to touch ./data (production).
 */
import { createHash, randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT, 'docs', 'demo-data');
const PROD_DIR = join(ROOT, 'data');
const SRC_DIR = '/tmp/grok-demo-imgs';

if (resolve(DATA_DIR) === resolve(PROD_DIR)) {
  throw new Error('refusing to seed production data/');
}
if (!DATA_DIR.endsWith(`${join('docs', 'demo-data')}`)) {
  throw new Error(`unexpected DATA_DIR: ${DATA_DIR}`);
}

const IMAGES = join(DATA_DIR, 'images');
const THUMBS = join(DATA_DIR, 'thumbs');

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function nowOffset(minutes) {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

async function saveJpeg(file, prompt, convId, kind, aspect, parentId, createdAt) {
  const input = readFileSync(join(SRC_DIR, file));
  const buf = await sharp(input).jpeg({ quality: 88 }).toBuffer();
  const sha = sha256(buf);
  const name = `${sha.slice(0, 16)}.jpg`;
  writeFileSync(join(IMAGES, name), buf);
  const thumb = await sharp(buf).resize(320, 320, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  writeFileSync(join(THUMBS, name), thumb);
  const meta = await sharp(buf).metadata();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO images (
      id, conversation_id, message_id, kind, prompt, negative_prompt,
      model, aspect_ratio, resolution, quality, n_index, parent_image_id,
      file_path, thumb_path, mime, width, height, sha256, created_at, status, error_message,
      job_id, extra_json
    ) VALUES (?, ?, NULL, ?, ?, NULL, ?, ?, '1k', NULL, 0, ?, ?, ?, 'image/jpeg', ?, ?, ?, ?, 'completed', NULL, NULL, NULL)
  `).run(
    id, convId, kind, prompt, 'grok-imagine-image-2.0', aspect, parentId,
    `images/${name}`, `thumbs/${name}`, meta.width || 1024, meta.height || 1024, sha, createdAt
  );
  return id;
}

if (existsSync(DATA_DIR)) rmSync(DATA_DIR, { recursive: true, force: true });
mkdirSync(IMAGES, { recursive: true });
mkdirSync(THUMBS, { recursive: true });
mkdirSync(join(DATA_DIR, 'audio'), { recursive: true });
mkdirSync(join(DATA_DIR, 'uploads'), { recursive: true });

const db = new Database(join(DATA_DIR, 'grok-studio.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_message_at TEXT NOT NULL,
    summary TEXT,
    summary_updated_at TEXT
  );
  CREATE TABLE messages (
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
  CREATE TABLE images (
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
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE vendors (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, label TEXT NOT NULL,
    base_url TEXT NOT NULL DEFAULT '', api_key TEXT NOT NULL DEFAULT '',
    extra_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE vendor_models (
    id TEXT PRIMARY KEY, vendor_id TEXT NOT NULL, model TEXT NOT NULL,
    capabilities TEXT NOT NULL, extra_json TEXT,
    FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
  );
  CREATE TABLE capability_bindings (
    capability TEXT PRIMARY KEY, vendor_id TEXT NOT NULL, model TEXT NOT NULL
  );
`);

function conv(title, minutes) {
  const id = randomUUID();
  const t = nowOffset(minutes);
  db.prepare(`INSERT INTO conversations (id, title, created_at, updated_at, last_message_at) VALUES (?, ?, ?, ?, ?)`).run(id, title, t, t, t);
  return id;
}
function msg(convId, role, content, minutes) {
  const id = randomUUID();
  db.prepare(`INSERT INTO messages (id, conversation_id, role, content, created_at, status) VALUES (?, ?, ?, ?, ?, 'completed')`)
    .run(id, convId, role, content, nowOffset(minutes));
  return id;
}

const trip = conv('周末去峡湾', 180);
msg(trip, 'user', '这周末想去看海和山，别太挤的那种。挪威那种悬崖+峡湾有没有参考图？', 175);
msg(trip, 'assistant', '可以。先出一张悬崖俯瞰峡湾的宽图，再补一张绿丘盘山公路，方便你看天气和构图。', 174);
await saveJpeg('mountain.jpg', '悬崖上俯瞰深蓝色峡湾，晴空，远处岩石与水面，宽幅风景摄影', trip, 'generate', '16:9', null, nowOffset(173));
await saveJpeg('forest.jpg', '雾气中的绿色悬崖和一条蜿蜒公路，阴天风景摄影', trip, 'generate', '16:9', null, nowOffset(170));
msg(trip, 'user', '第二张公路那张很喜欢，周末就按这个节奏走。', 168);
msg(trip, 'assistant', '好。右侧两张都在当前会话的图片资产里，去画廊也能按「周末去峡湾」筛出来。', 167);

const city = conv('城市速写', 120);
msg(city, 'user', '帮我出两张城市构图：一张黄昏天际线，一张从楼下往上拍的玻璃幕墙。', 118);
msg(city, 'assistant', '好。天际线用 4:3 方便做封面；仰拍用竖图，适合当壁纸。', 117);
const skyId = await saveJpeg('interior.jpg', '黄昏海边都市天际线，暖色天空与玻璃大楼，航拍感', city, 'generate', '4:3', null, nowOffset(116));
await saveJpeg('courtyard.jpg', '两栋玻璃幕墙大楼相对仰拍，中间留白天空，极简建筑摄影', city, 'edit', '9:16', skyId, nowOffset(110));
msg(city, 'assistant', '竖图是在天际线那张上改的构图。点开后可以用「去对话」跳回这个会话继续改。', 109);

const still = conv('静物练习', 80);
msg(still, 'user', '练手静物：咖啡、书桌、水果都行，光线干净一点。', 78);
msg(still, 'assistant', '三张：一杯拉花、木桌电脑、草莓特写。都可以当改图底图。', 77);
await saveJpeg('tea.jpg', '木桌上的一杯拉花咖啡，旁边铜铃和账单，咖啡馆静物', still, 'generate', '1:1', null, nowOffset(76));
await saveJpeg('desk.jpg', '原木桌上合上的笔记本、眼镜和鼠标，浅色墙面，产品静物', still, 'generate', '4:3', null, nowOffset(74));
await saveJpeg('flowers.jpg', '新鲜草莓特写，顶光，微距静物摄影', still, 'generate', '3:4', null, nowOffset(72));
msg(still, 'assistant', '三张都落在这个会话。选中右侧图片后，输入框会变成改图。', 71);

const wild = conv('野生动物', 40);
msg(wild, 'user', '要一张正面特写的大型猫科动物，眼神清楚，不要卡通。', 38);
msg(wild, 'assistant', '用母狮正面特写，浅景深，适合当头像或封面。', 37);
await saveJpeg('cat.jpg', '母狮正面特写，浅景深，野生动物摄影', wild, 'generate', '3:4', null, nowOffset(36));

const ts = nowOffset(1);
db.prepare(`INSERT INTO vendors (id, kind, label, base_url, api_key, extra_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
  .run('grok', 'grok', 'Grok', 'https://api.example.com/v1', '', '{}', ts, ts);
db.prepare(`INSERT INTO vendor_models (id, vendor_id, model, capabilities, extra_json) VALUES (?, 'grok', ?, ?, NULL)`).run(
  randomUUID(), 'grok-latest', JSON.stringify(['chat'])
);
db.prepare(`INSERT INTO vendor_models (id, vendor_id, model, capabilities, extra_json) VALUES (?, 'grok', ?, ?, NULL)`).run(
  randomUUID(), 'grok-imagine-image-2.0', JSON.stringify(['image.generate', 'image.edit'])
);
for (const [cap, model] of [
  ['chat', 'grok-latest'],
  ['image.generate', 'grok-imagine-image-2.0'],
  ['image.edit', 'grok-imagine-image-2.0'],
]) {
  db.prepare(`INSERT INTO capability_bindings (capability, vendor_id, model) VALUES (?, 'grok', ?)`).run(cap, model);
}

const settings = {
  chat_model: 'grok-latest',
  image_model: 'grok-imagine-image-2.0',
  default_aspect_ratio: '1:1',
  default_resolution: '1k',
  default_n: '1',
  chat_provider: 'grok',
  image_generate_provider: 'grok',
  image_edit_provider: 'grok',
};
const ins = db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)`);
for (const [k, v] of Object.entries(settings)) ins.run(k, v);

db.close();
console.log(`seeded demo data at ${DATA_DIR} (production ${PROD_DIR} untouched)`);
