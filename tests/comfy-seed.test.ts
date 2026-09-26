/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { vi } from 'vitest';

const TEST_DATA_DIR = join(process.cwd(), 'tests', '.tmp-comfy-seed');

describe('COMFY_BASE_URL seed', () => {
  let settingsApi: any;

  beforeAll(async () => {
    if (existsSync(TEST_DATA_DIR)) rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    vi.resetModules();
    process.env.DATA_DIR = TEST_DATA_DIR;
    process.env.COMFY_BASE_URL = 'http://comfy.example:8188/';
    process.env.GROK_BASE_URL = 'http://grok.example/v1';
    process.env.GROK_API_KEY = 'sk-test';
    settingsApi = await import('../app/api/settings/route');
  });

  afterAll(() => {
    delete process.env.COMFY_BASE_URL;
    if (existsSync(TEST_DATA_DIR)) {
      try { rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch {}
    }
  });

  it('seeds ComfyUI once and binds generate and edit to qwen-image-2.1', async () => {
    const first = await (await settingsApi.GET()).json();
    const comfy = first.vendors.find((v: any) => v.kind === 'comfyui');
    expect(comfy.base_url).toBe('http://comfy.example:8188/');
    expect(comfy.models[0].model).toBe('qwen-image-2.1');
    expect(first.bindings.find((b: any) => b.capability === 'image.generate')).toMatchObject({
      vendor_id: 'comfyui',
      model: 'qwen-image-2.1',
    });
    expect(first.bindings.find((b: any) => b.capability === 'image.edit')).toMatchObject({
      vendor_id: 'comfyui',
      model: 'qwen-image-2.1',
    });
    expect(first.active.generate.integration).toBe('comfyui');
    expect(first.resolved_image_generate_base_url).toBe('http://comfy.example:8188');
    expect(first.resolved_image_edit_base_url).toBe('http://comfy.example:8188');

    process.env.COMFY_BASE_URL = 'http://10.0.0.8:8188';
    const second = await (await settingsApi.GET()).json();
    const again = second.vendors.find((v: any) => v.kind === 'comfyui');
    expect(again.base_url).toBe('http://comfy.example:8188/');
    expect(second.bindings.filter((b: any) => b.capability === 'image.generate')).toHaveLength(1);
  });
});
