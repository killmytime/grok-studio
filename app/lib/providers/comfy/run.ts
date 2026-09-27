import { readFileSync } from 'fs';
import { comfyRoot, type CapabilityBackend } from '../../backends';
import { getBinding, getVendor, listVendors } from '../../vendors';
import { addImage, getImage, listImagesByJob, updateImage } from '../../db';
import { canonicalIntegrationId } from '../../integrations/catalog';
import { finalizePendingImage, getImageFilePath } from '../../image';
import { mergeImageMeta } from '../../image-meta';
import { aspectToSize, snapToMultiple } from '../image-unpack';
import { nearestAspect, normalizeResolution } from '../../image-presets';
import type { ImageAsset } from '../../types';
import {
  ComfyError,
  cancelQueuedPrompt,
  collectOutputImages,
  fetchView,
  getHistoryEntry,
  historyErrorMessage,
  submitPrompt,
  uploadImage,
} from './client';
import { prepareEditWorkflow, prepareGenerateWorkflow, prepareRedrawWorkflow, type PreparedWorkflow } from './workflow';

const inflight = new Map<string, AbortController>();
const finalizing = new Map<string, Promise<void>>();

const POLL_MS = 1000;
const DEADLINE_MS = 10 * 60 * 1000;

function optionalInt(value: unknown): number | undefined {
  if (value == null || String(value).trim() === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.round(n);
}

const RECOMMENDED_DENOISE = 0.85;

/** Empty uses the recommended redraw. 0 keeps the reference-encoder edit. */
function editDenoise(value: unknown): number | null {
  const raw = value == null ? '' : String(value).trim();
  if (raw === '' ) return RECOMMENDED_DENOISE;
  if (raw === '0' || raw === '参考') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    throw new ComfyError('重绘强度要写在 0 和 1 之间。空着就是 0.85，填 0 只用参考图节点', 400);
  }
  if (n === 0) return null;
  return Math.round(n * 100) / 100;
}

function vendorExtra(capability: 'image.generate' | 'image.edit'): Record<string, unknown> {
  const binding = getBinding(capability);
  if (!binding) return {};
  const vendor = getVendor(binding.vendor_id);
  if (!vendor || canonicalIntegrationId(vendor.kind) !== 'comfyui') return {};
  return vendor.extra || {};
}

export function apiKeyForComfy(baseUrl: string): string {
  const root = comfyRoot(baseUrl);
  const vendor = listVendors().find((v) => canonicalIntegrationId(v.kind) === 'comfyui' && comfyRoot(v.base_url) === root);
  return vendor?.api_key || '';
}

function unetFromModel(model: string): string | undefined {
  if (/\.(safetensors|gguf|sft|pt)$/i.test(model)) return model;
  return undefined;
}

function resolutionSide(resolution: string): number {
  const id = normalizeResolution(resolution);
  if (id === '512') return 512;
  if (id === '2k') return 2048;
  return 1024;
}

function snapSize(aspect: string, resolution: string): { width: number; height: number } {
  const dims = aspectToSize(aspect, resolution);
  return {
    width: snapToMultiple(dims.width, 32),
    height: snapToMultiple(dims.height, 32),
  };
}

function abortError(): Error {
  const err = new Error('cancelled');
  err.name = 'AbortError';
  return err;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(abortError());
    }, { once: true });
  });
}

function markJobError(promptId: string, message: string) {
  for (const row of listImagesByJob(promptId)) {
    if (row.status === 'pending') updateImage(row.id, { status: 'error', error_message: message });
  }
}

async function finalizeFromEntry(promptId: string, entry: any, baseUrl: string, apiKey: string): Promise<void> {
  const existing = finalizing.get(promptId);
  if (existing) return existing;
  const job = doFinalize(promptId, entry, baseUrl, apiKey).finally(() => finalizing.delete(promptId));
  finalizing.set(promptId, job);
  return job;
}

async function doFinalize(promptId: string, entry: any, baseUrl: string, apiKey: string): Promise<void> {
  const rows = listImagesByJob(promptId);
  const pending = rows.filter((row) => row.status === 'pending').sort((a, b) => a.n_index - b.n_index);
  if (pending.length === 0) return;
  const failed = historyErrorMessage(entry);
  if (failed) {
    markJobError(promptId, failed);
    return;
  }
  const files = collectOutputImages(entry);
  if (files.length === 0) {
    markJobError(promptId, 'ComfyUI 完成了但没有图像');
    return;
  }
  const started = Number(rows[0]?.extra_json?.started_at) || Date.now();
  for (let i = 0; i < pending.length; i++) {
    const file = files[i];
    if (!file) {
      updateImage(pending[i].id, { status: 'error', error_message: 'ComfyUI 没有返回这一张' });
      continue;
    }
    const buf = await fetchView(baseUrl, apiKey, file);
    const mime = /\.jpe?g$/i.test(file.filename) ? 'image/jpeg' : 'image/png';
    await finalizePendingImage(pending[i].id, buf, mime);
    mergeImageMeta(pending[i].id, { elapsed_ms: Date.now() - started });
  }
}

async function watch(promptId: string, baseUrl: string, apiKey: string, signal: AbortSignal) {
  const deadline = Date.now() + DEADLINE_MS;
  while (!signal.aborted) {
    const entry = await getHistoryEntry(baseUrl, apiKey, promptId);
    if (entry?.status?.completed) {
      await finalizeFromEntry(promptId, entry, baseUrl, apiKey);
      return;
    }
    if (Date.now() > deadline) throw new ComfyError('ComfyUI 等待超时（10 分钟）', 504);
    await sleep(POLL_MS, signal);
  }
  throw abortError();
}

function startWatch(promptId: string, baseUrl: string, apiKey: string) {
  const ac = new AbortController();
  inflight.set(promptId, ac);
  void (async () => {
    try {
      await watch(promptId, baseUrl, apiKey, ac.signal);
    } catch (e: any) {
      const message = e?.name === 'AbortError' ? 'cancelled' : (e?.message || 'ComfyUI 失败');
      markJobError(promptId, message);
    } finally {
      inflight.delete(promptId);
    }
  })();
}

function pendingRows(opts: {
  promptId: string;
  prepared: PreparedWorkflow;
  count: number;
  conversationId: string;
  prompt: string;
  model: string;
  aspect: string;
  resolution: string;
  kind: ImageAsset['kind'];
  parentId?: string;
  baseUrl: string;
  width: number;
  height: number;
  denoise?: number | null;
}): ImageAsset[] {
  const images: ImageAsset[] = [];
  for (let i = 0; i < opts.count; i++) {
    images.push(addImage({
      conversation_id: opts.conversationId,
      message_id: null,
      kind: opts.kind,
      prompt: opts.prompt,
      negative_prompt: opts.prepared.negative,
      model: opts.model,
      aspect_ratio: opts.aspect,
      resolution: opts.resolution,
      quality: null,
      n_index: i + 1,
      parent_image_id: opts.parentId || null,
      file_path: '',
      thumb_path: '',
      mime: 'image/png',
      width: opts.width,
      height: opts.height,
      sha256: '',
      status: 'pending',
      job_id: opts.promptId,
      extra_json: {
        provider: 'comfyui',
        protocol: 'comfyui',
        size: `${opts.width}x${opts.height}`,
        n: opts.count,
        seed: opts.prepared.seed,
        steps: opts.prepared.steps,
        ...(opts.denoise != null ? { denoise: opts.denoise } : {}),
        comfy_base_url: opts.baseUrl,
        started_at: Date.now(),
      },
    }));
  }
  return images;
}

function asComfyError(e: unknown): ComfyError {
  if (e instanceof ComfyError) return e;
  const message = e instanceof Error ? e.message : 'ComfyUI 失败';
  const status = /必填|工作流/.test(message) ? 400 : 502;
  return new ComfyError(message, status);
}

export async function submitComfyGenerate(opts: {
  prompt: string;
  n?: number;
  aspect_ratio?: string;
  resolution?: string;
  conversation_id: string;
  negative_prompt?: string;
  backend: CapabilityBackend;
}): Promise<{ images: ImageAsset[] }> {
  const baseUrl = comfyRoot(opts.backend.baseUrl);
  if (!baseUrl) throw new ComfyError('ComfyUI 地址未配置', 400);
  const n = Math.min(Math.max(1, parseInt(String(opts.n ?? 1), 10) || 1), 4);
  const aspect = opts.aspect_ratio || '1:1';
  const resolution = opts.resolution || '1k';
  const dims = snapSize(aspect, resolution);
  const extra = vendorExtra('image.generate');
  const apiKey = opts.backend.apiKey || apiKeyForComfy(baseUrl);
  let prepared: PreparedWorkflow;
  try {
    prepared = prepareGenerateWorkflow({
      positive: opts.prompt,
      negative: opts.negative_prompt,
      width: dims.width,
      height: dims.height,
      batch: n,
      seed: optionalInt(extra.seed),
      steps: optionalInt(extra.steps),
      unetName: unetFromModel(opts.backend.model),
    });
  } catch (e) {
    throw asComfyError(e);
  }
  const promptId = await submitPrompt(baseUrl, apiKey, prepared.graph);
  const images = pendingRows({
    promptId,
    prepared,
    count: n,
    conversationId: opts.conversation_id,
    prompt: opts.prompt,
    model: opts.backend.model || 'qwen-image-2.1',
    aspect,
    resolution,
    kind: 'generate',
    baseUrl,
    width: dims.width,
    height: dims.height,
  });
  startWatch(promptId, baseUrl, apiKey);
  return { images };
}

function fileExt(mime: string, filePath: string): { ext: string; mime: string } {
  if (mime.includes('jpeg') || /\.jpe?g$/i.test(filePath)) return { ext: 'jpg', mime: 'image/jpeg' };
  if (mime.includes('webp') || /\.webp$/i.test(filePath)) return { ext: 'webp', mime: 'image/webp' };
  return { ext: 'png', mime: 'image/png' };
}

export async function submitComfyEdit(opts: {
  prompt: string;
  image_id: string;
  aspect_ratio?: string;
  resolution?: string;
  conversation_id: string;
  negative_prompt?: string;
  backend: CapabilityBackend;
  source: ImageAsset;
}): Promise<{ images: ImageAsset[] }> {
  const baseUrl = comfyRoot(opts.backend.baseUrl);
  if (!baseUrl) throw new ComfyError('ComfyUI 地址未配置', 400);
  if (!opts.prompt?.trim()) throw new ComfyError('正向提示词必填', 400);
  if (!opts.source.file_path) throw new ComfyError('原图还没有文件', 400);
  const resolution = opts.resolution || '1k';
  const side = resolutionSide(resolution);
  const extra = vendorExtra('image.edit');
  let denoise: number | null;
  try {
    denoise = editDenoise(extra.denoise);
  } catch (e) {
    throw asComfyError(e);
  }
  const apiKey = opts.backend.apiKey || apiKeyForComfy(baseUrl);
  const { ext, mime } = fileExt(opts.source.mime || '', opts.source.file_path);
  const filename = `studio-${opts.source.id.slice(0, 8)}-${Date.now()}.${ext}`;
  let uploaded: string;
  try {
    const bytes = readFileSync(/* turbopackIgnore: true */ getImageFilePath(opts.source.file_path));
    uploaded = await uploadImage(baseUrl, apiKey, bytes, filename, mime);
  } catch (e) {
    throw asComfyError(e);
  }
  let prepared: PreparedWorkflow;
  try {
    const shared = {
      positive: opts.prompt,
      negative: opts.negative_prompt,
      imageName: uploaded,
      seed: optionalInt(extra.seed),
      steps: optionalInt(extra.steps),
      unetName: unetFromModel(opts.backend.model),
    };
    prepared = denoise == null
      ? prepareEditWorkflow({ ...shared, resolution: side })
      : prepareRedrawWorkflow({ ...shared, denoise });
  } catch (e) {
    throw asComfyError(e);
  }
  const promptId = await submitPrompt(baseUrl, apiKey, prepared.graph);
  const aspect = opts.source.width && opts.source.height
    ? nearestAspect(opts.source.width, opts.source.height)
    : (opts.aspect_ratio || '1:1');
  const images = pendingRows({
    promptId,
    prepared,
    count: 1,
    conversationId: opts.conversation_id,
    prompt: opts.prompt,
    model: opts.backend.model || 'qwen-image-2.1',
    aspect,
    resolution,
    kind: 'edit',
    parentId: opts.image_id,
    baseUrl,
    width: opts.source.width || side,
    height: opts.source.height || side,
    denoise,
  });
  startWatch(promptId, baseUrl, apiKey);
  return { images };
}

export async function reconcileComfyImage(img: ImageAsset): Promise<ImageAsset | undefined> {
  if (!img || img.status !== 'pending' || !img.job_id) return img;
  const baseUrl = String(img.extra_json?.comfy_base_url || '');
  if (!baseUrl) return img;
  try {
    const entry = await getHistoryEntry(baseUrl, apiKeyForComfy(baseUrl), img.job_id);
    if (!entry?.status?.completed) return getImage(img.id) || img;
    await finalizeFromEntry(img.job_id, entry, baseUrl, apiKeyForComfy(baseUrl));
  } catch {
    return getImage(img.id) || img;
  }
  return getImage(img.id) || img;
}

export async function cancelComfyImage(img: ImageAsset): Promise<void> {
  const promptId = img.job_id || '';
  if (promptId) inflight.get(promptId)?.abort();
  const baseUrl = String(img.extra_json?.comfy_base_url || '');
  if (promptId && baseUrl) {
    await cancelQueuedPrompt(baseUrl, apiKeyForComfy(baseUrl), promptId);
  }
}
