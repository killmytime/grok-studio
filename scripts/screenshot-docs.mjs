#!/usr/bin/env node
/**
 * Starts Next on :3010 with docs/demo-data and writes docs/screenshots/*.png.
 * Never points DATA_DIR at ./data.
 */
import { spawn } from 'child_process';
import { mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from '@playwright/test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEMO_DIR = join(ROOT, 'docs', 'demo-data');
const PROD_DIR = join(ROOT, 'data');
const OUT = join(ROOT, 'docs', 'screenshots');
const PORT = 3010;
const BASE = `http://127.0.0.1:${PORT}`;

if (resolve(DEMO_DIR) === resolve(PROD_DIR)) {
  throw new Error('refusing to screenshot production data/');
}

mkdirSync(OUT, { recursive: true });

function waitForHttp(url, timeoutMs = 60_000) {
  const start = Date.now();
  return new Promise((resolveWait, reject) => {
    const tick = async () => {
      try {
        const res = await fetch(url, { redirect: 'manual' });
        if (res.status < 500) return resolveWait();
      } catch {}
      if (Date.now() - start > timeoutMs) return reject(new Error(`timeout waiting for ${url}`));
      setTimeout(tick, 400);
    };
    tick();
  });
}

const child = spawn(
  'pnpm',
  ['exec', 'next', 'dev', '-H', '127.0.0.1', '-p', String(PORT)],
  {
    cwd: ROOT,
    env: {
      ...process.env,
      DATA_DIR: DEMO_DIR,
      PORT: String(PORT),
      STUDIO_PASSWORD: '',
      ACCESS_PASSWORD: '',
      BROWSER: 'none',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  }
);

let logs = '';
child.stdout.on('data', (d) => { logs += d; });
child.stderr.on('data', (d) => { logs += d; });

function stop() {
  if (!child.killed) {
    child.kill('SIGTERM');
    setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 1500);
  }
}

process.on('exit', stop);
process.on('SIGINT', () => { stop(); process.exit(1); });

try {
  await waitForHttp(BASE);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
    locale: 'zh-CN',
  });
  async function hideDevUi(p) {
    await p.addStyleTag({
      content: 'nextjs-portal, [data-next-badge-root] { display: none !important; }',
    });
  }

  const page = await context.newPage();

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await hideDevUi(page);
  await page.getByText('周末去峡湾').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, 'studio.png'), type: 'png' });

  await page.locator('button:has(svg.lucide-settings)').first().click();
  await page.getByText('设置').first().waitFor({ timeout: 10_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, 'settings.png'), type: 'png' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  await page.getByText('周末去峡湾').click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, 'studio-chat.png'), type: 'png' });

  await page.goto(`${BASE}/gallery`, { waitUntil: 'networkidle' });
  await hideDevUi(page);
  await page.getByText('画廊').first().waitFor({ timeout: 15_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(OUT, 'gallery.png'), type: 'png' });

  await page.locator('img').first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, 'gallery-lightbox.png'), type: 'png' });
  await page.keyboard.press('Escape');

  const mobile = await context.newPage();
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(BASE, { waitUntil: 'networkidle' });
  await hideDevUi(mobile);
  await mobile.waitForTimeout(800);
  await mobile.screenshot({ path: join(OUT, 'studio-mobile.png'), type: 'png' });
  await mobile.goto(`${BASE}/gallery`, { waitUntil: 'networkidle' });
  await hideDevUi(mobile);
  await mobile.waitForTimeout(800);
  await mobile.screenshot({ path: join(OUT, 'gallery-mobile.png'), type: 'png' });

  await browser.close();
  console.log(`wrote screenshots to ${OUT}`);
} catch (e) {
  console.error(logs.slice(-4000));
  throw e;
} finally {
  stop();
}
