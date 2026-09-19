import { addImage, getImage, updateImage } from '../db';
import {
  finalizePendingImageFromBase64,
  finalizePendingImageFromUrl,
  saveImageFromBase64,
  saveImageFromUrl,
} from '../image';
import { resolveImageGenerateBackend, bearerHeaders, type ImageGenerateBackend } from '../backends';
import { canonicalIntegrationId, hasCapability, getIntegration } from '../integrations/catalog';
import { aspectToSize, formatOpenAISize, normalizeB64, unpackImageItems, withSdCppExtraArgs } from './image-unpack';
import { jetsonCancelJob, jetsonGetJob, jetsonImagesGenerations } from './jetson';
import type { ImageAsset } from '../types';

const jetsonInflight = new Map<string, AbortController>();

export class ProviderError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status = 502, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function persistGrokItems(
  items: any[],
  conversationId: string,
  prompt: string,
  model: string,
  aspect: string,
  resolution: string,
  kind: ImageAsset['kind'] = 'generate',
  parentId?: string
): Promise<ImageAsset[]> {
  const assets: ImageAsset[] = [];
  for (const item of items) {
    const b64 = item.b64_json || item.base64 || item.image_base64 || (typeof item === 'string' ? item : null);
    let asset: ImageAsset | undefined;
    if (b64) {
      asset = await saveImageFromBase64(
        normalizeB64(b64),
        conversationId,
        prompt,
        model,
        aspect,
        resolution,
        kind,
        parentId,
        undefined,
        item.mime || 'image/png'
      );
    } else if (item.url) {
      asset = await saveImageFromUrl(item.url, conversationId, prompt, model, aspect, resolution, kind, parentId);
    } else if (item.image) {
      asset = await saveImageFromBase64(item.image, conversationId, prompt, model, aspect, resolution, kind, parentId);
    }
    if (asset) assets.push(asset);
  }
  return assets;
}

export async function grokGenerate(opts: {
  prompt: string;
  n?: number;
  aspect_ratio?: string;
  resolution?: string;
  conversation_id: string;
  quality?: string;
  backend?: ImageGenerateBackend;
}): Promise<{ images: ImageAsset[] }> {
  const backend = opts.backend || resolveImageGenerateBackend();
  if (!backend.baseUrl || !backend.apiKey) {
    throw new ProviderError('API not configured', 400);
  }
  const n = Math.min(Math.max(1, parseInt(String(opts.n ?? 1), 10) || 1), 4);
  const aspect = opts.aspect_ratio || '1:1';
  const resolution = opts.resolution || '1k';
  const body: Record<string, unknown> = {
    model: backend.model,
    prompt: opts.prompt,
    n,
    aspect_ratio: aspect,
    resolution,
  };
  if (opts.quality) body.quality = opts.quality;

  const res = await fetch(`${backend.baseUrl}/images/generations`, {
    method: 'POST',
    headers: bearerHeaders(backend.apiKey),
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ProviderError('Upstream error', 502, { status: res.status, body: data });
  }
  const items = unpackImageItems(data);
  const images = await persistGrokItems(items, opts.conversation_id, opts.prompt, backend.model, aspect, resolution);
  return { images };
}

export async function jetsonGenerate(opts: {
  prompt: string;
  n?: number;
  aspect_ratio?: string;
  resolution?: string;
  conversation_id: string;
  negative_prompt?: string;
  backend?: ImageGenerateBackend;
}): Promise<{ images: ImageAsset[]; job_id?: string }> {
  const backend = opts.backend || resolveImageGenerateBackend();
  if (!backend.jetsonGatewayUrl) {
    throw new ProviderError('Jetson gateway URL not configured', 400);
  }
  const n = Math.min(Math.max(1, parseInt(String(opts.n ?? 1), 10) || 1), 4);
  const aspect = opts.aspect_ratio || '1:1';
  const resolution = opts.resolution || '1k';
  const dims = aspectToSize(aspect, resolution);
  const size = formatOpenAISize(dims.width, dims.height);
  const model = backend.model || 'sd-cpp-local';
  const prompt = withSdCppExtraArgs(opts.prompt, { steps: backend.jetsonSteps, seed: backend.jetsonSeed });

  const extra = {
    provider: 'imagen',
    protocol: 'openai-images',
    size,
    model,
  };
  const asset = addImage({
    conversation_id: opts.conversation_id,
    message_id: null,
    kind: 'generate',
    prompt: opts.prompt,
    negative_prompt: opts.negative_prompt || null,
    model,
    aspect_ratio: aspect,
    resolution,
    quality: null,
    n_index: 1,
    parent_image_id: null,
    file_path: '',
    thumb_path: '',
    mime: 'image/png',
    width: dims.width,
    height: dims.height,
    sha256: '',
    status: 'pending',
    extra_json: extra,
  });

  const ac = new AbortController();
  jetsonInflight.set(asset.id, ac);
  void (async () => {
    try {
      const data = await jetsonImagesGenerations(
        backend.jetsonGatewayUrl,
        backend.jetsonApiKey,
        { model, prompt, n, size, response_format: 'b64_json' },
        ac.signal
      );
      const items = unpackImageItems(data);
      const first = items[0];
      const b64 = first?.b64_json || first?.base64 || first?.image_base64;
      if (b64) {
        await finalizePendingImageFromBase64(asset.id, normalizeB64(b64), first?.mime || 'image/png');
        return;
      }
      if (first?.url) {
        await finalizePendingImageFromUrl(asset.id, first.url);
        return;
      }
      updateImage(asset.id, { status: 'error', error_message: 'Jetson returned no image payload' });
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        updateImage(asset.id, { status: 'error', error_message: 'cancelled' });
        return;
      }
      updateImage(asset.id, { status: 'error', error_message: e?.message || 'Jetson generate failed' });
    } finally {
      jetsonInflight.delete(asset.id);
    }
  })();

  return { images: [asset] };
}

type GenerateFn = (opts: {
  prompt: string;
  n?: number;
  aspect_ratio?: string;
  resolution?: string;
  conversation_id: string;
  quality?: string;
  negative_prompt?: string;
  backend?: ImageGenerateBackend;
}) => Promise<{ images: ImageAsset[]; job_id?: string }>;

/** Plug in a new generate integration by adding it to the catalog and this map. */
const GENERATE_ADAPTERS: Record<string, GenerateFn> = {
  grok: grokGenerate,
  imagen: jetsonGenerate,
};

export async function generateImages(opts: {
  prompt: string;
  n?: number;
  aspect_ratio?: string;
  resolution?: string;
  conversation_id: string;
  quality?: string;
  negative_prompt?: string;
}): Promise<{ images: ImageAsset[]; job_id?: string }> {
  const backend = resolveImageGenerateBackend();
  const id = canonicalIntegrationId(backend.provider);
  if (!hasCapability(id, 'image.generate')) {
    throw new ProviderError(`${getIntegration(id).label} 不支持生图`, 400);
  }
  const adapter = GENERATE_ADAPTERS[id];
  if (!adapter) {
    throw new ProviderError(`没有已注册的生图集成：${id}`, 400);
  }
  return adapter({ ...opts, backend });
}

export async function reconcilePendingImage(img: ImageAsset): Promise<ImageAsset | undefined> {
  if (!img || img.status !== 'pending') return img;
  // OpenAI imagen is Studio-side in-flight; just re-read the row.
  if (img.extra_json?.protocol === 'openai-images' || !img.job_id) {
    return getImage(img.id) || img;
  }
  const backend = resolveImageGenerateBackend();
  if (!backend.jetsonGatewayUrl) {
    return updateImage(img.id, { status: 'error', error_message: 'Jetson gateway URL not configured' });
  }
  try {
    const job = await jetsonGetJob(backend.jetsonGatewayUrl, backend.jetsonApiKey, img.job_id);
    if (job.status === 'queued' || job.status === 'running') {
      const extra = { ...(img.extra_json || {}), provider: 'jetson', queue_position: job.position ?? 0, job_id: job.id };
      return updateImage(img.id, { extra_json: extra, status: 'pending' });
    }
    if (job.status === 'completed') {
      const item = job.images?.[0];
      if (item?.b64_json) {
        return finalizePendingImageFromBase64(img.id, item.b64_json);
      }
      if (item?.url) {
        return finalizePendingImageFromUrl(img.id, item.url);
      }
      return updateImage(img.id, { status: 'error', error_message: 'Job completed with no image payload' });
    }
    if (job.status === 'failed' || job.status === 'cancelled') {
      return updateImage(img.id, { status: 'error', error_message: job.error || job.status });
    }
    return img;
  } catch {
    return img;
  }
}

export async function cancelPendingImage(img: ImageAsset): Promise<ImageAsset | undefined> {
  if (!img) return img;
  jetsonInflight.get(img.id)?.abort();
  jetsonInflight.delete(img.id);
  const backend = resolveImageGenerateBackend();
  if (img.job_id && backend.jetsonGatewayUrl) {
    try {
      await jetsonCancelJob(backend.jetsonGatewayUrl, backend.jetsonApiKey, img.job_id);
    } catch {
      // still mark cancelled locally
    }
  }
  return updateImage(img.id, { status: 'error', error_message: 'cancelled' }) || getImage(img.id);
}
