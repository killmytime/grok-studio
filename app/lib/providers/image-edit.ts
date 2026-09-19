import { imageToDataUri, saveImageFromBase64, saveImageFromUrl } from '../image';
import { getImage, getSetting } from '../db';
import { bearerHeaders, resolveImageEditBackend, type CapabilityBackend } from '../backends';
import { getIntegration, hasCapability } from '../integrations/catalog';
import { normalizeB64, unpackImageItems } from './image-unpack';
import { ProviderError } from './image-generate';
import type { ImageAsset } from '../types';

export async function grokEdit(opts: {
  prompt: string;
  image_id: string;
  n?: number;
  aspect_ratio?: string;
  resolution?: string;
  conversation_id: string;
  backend?: CapabilityBackend;
}): Promise<{ images: ImageAsset[]; mode?: string }> {
  const backend = opts.backend || resolveImageEditBackend();
  if (!hasCapability(backend.provider, 'image.edit')) {
    throw new ProviderError(`${getIntegration(backend.provider).label} 不支持改图`, 400);
  }
  if (!backend.baseUrl || !backend.apiKey) {
    throw new ProviderError('API not configured', 400);
  }
  const sourceImg = getImage(opts.image_id);
  if (!sourceImg) throw new ProviderError('Source image not found', 404);
  if (sourceImg.status === 'pending') {
    throw new ProviderError('Source image is still generating', 409);
  }

  const dataUri = await imageToDataUri(sourceImg.file_path);
  const n = Math.min(Math.max(1, parseInt(String(opts.n ?? 1), 10) || 1), 4);
  const aspect = opts.aspect_ratio || 'auto';
  const resolution = opts.resolution || '1k';
  const mode = getSetting('edit_compatibility_mode', 'json');

  if (mode === 'json') {
    const body = {
      model: backend.model,
      prompt: opts.prompt,
      image: { url: dataUri },
      n,
      aspect_ratio: aspect,
      resolution,
    };
    const res = await fetch(`${backend.baseUrl}/images/edits`, {
      method: 'POST',
      headers: bearerHeaders(backend.apiKey),
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new ProviderError('Edit failed', 502, { status: res.status, body: data, mode });
    }
    const items = unpackImageItems(data);
    const images: ImageAsset[] = [];
    for (const item of items) {
      const b64 = item.b64_json || item.base64 || item.image_base64;
      let asset;
      if (b64) {
        asset = await saveImageFromBase64(
          normalizeB64(b64),
          opts.conversation_id,
          opts.prompt,
          backend.model,
          aspect,
          resolution,
          'edit',
          opts.image_id
        );
      } else if (item.url) {
        asset = await saveImageFromUrl(
          item.url,
          opts.conversation_id,
          opts.prompt,
          backend.model,
          aspect,
          resolution,
          'edit',
          opts.image_id
        );
      }
      if (asset) images.push(asset);
    }
    return { images };
  }

  if (mode === 'generations') {
    const body = {
      model: backend.model,
      prompt: opts.prompt,
      image: dataUri,
      n: 1,
      aspect_ratio: aspect,
      resolution,
    };
    const res = await fetch(`${backend.baseUrl}/images/generations`, {
      method: 'POST',
      headers: bearerHeaders(backend.apiKey),
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ProviderError('Fallback failed', 502, { status: res.status, body: data });
    const items = unpackImageItems(data);
    const images: ImageAsset[] = [];
    for (const item of items) {
      let asset;
      if (item.b64_json) {
        asset = await saveImageFromBase64(
          item.b64_json,
          opts.conversation_id,
          opts.prompt,
          backend.model,
          aspect,
          resolution,
          'edit',
          opts.image_id
        );
      } else if (item.url) {
        asset = await saveImageFromUrl(
          item.url,
          opts.conversation_id,
          opts.prompt,
          backend.model,
          aspect,
          resolution,
          'edit',
          opts.image_id
        );
      }
      if (asset) images.push(asset);
    }
    return { images, mode: 'generations' };
  }

  throw new ProviderError('Edit compatibility mode set to error only', 400);
}

type EditFn = typeof grokEdit;

const EDIT_ADAPTERS: Record<string, EditFn> = {
  grok: grokEdit,
};

export async function editImages(opts: {
  prompt: string;
  image_id: string;
  n?: number;
  aspect_ratio?: string;
  resolution?: string;
  conversation_id: string;
}): Promise<{ images: ImageAsset[]; mode?: string }> {
  const backend = resolveImageEditBackend();
  if (!hasCapability(backend.provider, 'image.edit')) {
    throw new ProviderError(`${getIntegration(backend.provider).label} 不支持改图`, 400);
  }
  const adapter = EDIT_ADAPTERS[backend.provider];
  if (!adapter) {
    throw new ProviderError(`没有已注册的改图集成：${backend.provider}`, 400);
  }
  return adapter({ ...opts, backend });
}
