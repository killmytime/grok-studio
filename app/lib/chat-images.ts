import { readFileSync, existsSync } from 'fs';
import { updateImage } from './db';
import { getImageFilePath, saveImageFromBase64 } from './image';
import { windowTurns, type ChatTurn } from './chat-context';
import { nearestAspect, resolutionFromPixels } from './image-presets';
import { normalizeB64 } from './providers/image-unpack';
import type { ImageAsset } from './types';

/** How many earlier chat images to send back so a follow-up can edit them. */
export const MAX_REHYDRATED_IMAGES = 4;

const CHAT_IMAGE_MODEL = 'grok-imagine-image-2.0';

export type ResponsesNotice =
  | { type: 'text'; delta: string }
  | { type: 'status'; status: string }
  | { type: 'image'; item: Record<string, any> }
  | { type: 'response_id'; id: string }
  | { type: 'error'; message: string };

export function responsesUnsupported(status: number): boolean {
  return status === 404 || status === 405 || status === 501;
}

export function imageCallsOf(extra: { image_calls?: unknown } | null | undefined): Array<Record<string, any>> {
  const calls = extra?.image_calls;
  return Array.isArray(calls) ? calls.filter((c) => c && typeof c === 'object') as Array<Record<string, any>> : [];
}

/** Scalar fields from an image_generation_call, never the base64 result. */
export function storedImageCall(item: Record<string, any>, imageId: string): Record<string, unknown> {
  const out: Record<string, unknown> = { type: 'image_generation_call', image_id: imageId };
  for (const [key, value] of Object.entries(item || {})) {
    if (key === 'result' || key === 'image_id') continue;
    if (value == null) continue;
    if (typeof value === 'string') {
      if (value.length > 4000) continue;
      out[key] = value;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    }
  }
  return out;
}

export function noticesFromResponsesPayload(payload: string): ResponsesNotice[] {
  let data: any;
  try {
    data = JSON.parse(payload);
  } catch {
    return [];
  }
  const notices: ResponsesNotice[] = [];
  const type = String(data?.type || '');
  if (type === 'response.output_text.delta' && typeof data.delta === 'string' && data.delta) {
    notices.push({ type: 'text', delta: data.delta });
  }
  if (type.startsWith('response.image_generation_call.')) {
    const phase = type.slice('response.image_generation_call.'.length);
    if (phase === 'in_progress' || phase === 'generating') {
      notices.push({ type: 'status', status: 'generating' });
    }
  }
  if (type === 'response.output_item.done' && data.item?.type === 'image_generation_call') {
    notices.push({ type: 'image', item: data.item });
  }
  if (type === 'response.completed' || type === 'response.created') {
    const id = data.response?.id || data.id;
    if (typeof id === 'string' && id) notices.push({ type: 'response_id', id });
  }
  if (type === 'response.completed' && Array.isArray(data.response?.output)) {
    for (const item of data.response.output) {
      if (item?.type === 'image_generation_call') notices.push({ type: 'image', item });
    }
  }
  if (type === 'error' || type === 'response.failed') {
    const message = data.error?.message || data.response?.error?.message || data.message || '生图或回复失败';
    notices.push({ type: 'error', message: String(message) });
  }
  return notices;
}

export function imageCallKey(item: Record<string, any>): string {
  if (item?.id) return String(item.id);
  const prompt = String(item?.prompt || '').slice(0, 80);
  const size = typeof item?.result === 'string' ? item.result.length : 0;
  return `anon:${prompt}:${size}`;
}

export function buildResponsesInput(
  msgs: Array<ChatTurn & { extra_json?: { image_calls?: unknown } | null }>,
  summary: string | null | undefined,
  rehydrate: (imageId: string) => string | null,
  imageBudget = MAX_REHYDRATED_IMAGES
): unknown[] {
  const { summaryText, turns } = windowTurns(msgs, summary);
  const chosen = new Set<string>();
  let left = imageBudget;
  for (let i = turns.length - 1; i >= 0 && left > 0; i--) {
    const calls = imageCallsOf(turns[i].extra_json);
    for (let j = calls.length - 1; j >= 0 && left > 0; j--) {
      const key = String(calls[j].id || calls[j].image_id || '');
      if (!key || chosen.has(key)) continue;
      chosen.add(key);
      left--;
    }
  }

  const input: unknown[] = [];
  if (summaryText) input.push({ role: 'system', content: `[对话摘要]\n${summaryText}` });
  for (const turn of turns) {
    const calls = imageCallsOf(turn.extra_json).filter((call) =>
      chosen.has(String(call.id || call.image_id || ''))
    );
    if (turn.role === 'assistant' && calls.length) {
      const text = String(turn.content || '').trim();
      let pushedCall = false;
      if (text) {
        input.push({
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text }],
        });
      }
      for (const call of calls) {
        const imageId = String(call.image_id || '');
        const b64 = imageId ? rehydrate(imageId) : null;
        if (!b64) continue;
        pushedCall = true;
        const { image_id: _imageId, result: _result, ...rest } = call;
        input.push({
          ...rest,
          type: 'image_generation_call',
          status: rest.status || 'completed',
          result: b64,
        });
      }
      if (text || pushedCall) continue;
    }
    input.push({ role: turn.role, content: String(turn.content || '') });
  }
  return input;
}

export function imageFileBase64(filePath: string): string | null {
  try {
    const full = getImageFilePath(filePath);
    if (!existsSync(/* turbopackIgnore: true */ full)) return null;
    return readFileSync(/* turbopackIgnore: true */ full).toString('base64');
  } catch {
    return null;
  }
}

export function slimChatImage(asset: ImageAsset) {
  return {
    id: asset.id,
    prompt: asset.prompt,
    file_path: asset.file_path,
    thumb_path: asset.thumb_path,
    kind: asset.kind,
    model: asset.model,
    aspect_ratio: asset.aspect_ratio,
    resolution: asset.resolution,
    width: asset.width,
    height: asset.height,
  };
}

export async function saveChatToolImage(opts: {
  item: Record<string, any>;
  conversationId: string;
  messageId?: string;
  chatModel: string;
  responseId?: string | null;
  nIndex: number;
}): Promise<{ asset: ImageAsset; call: Record<string, unknown> } | null> {
  const raw = typeof opts.item?.result === 'string' ? opts.item.result : '';
  if (!raw.trim()) return null;
  const prompt = typeof opts.item.prompt === 'string' ? opts.item.prompt.trim() : '';
  const callId = String(opts.item.id || '');
  const kind: ImageAsset['kind'] = callId.startsWith('ie_') ? 'edit' : 'generate';
  const model = typeof opts.item.model === 'string' && opts.item.model.trim()
    ? opts.item.model.trim()
    : CHAT_IMAGE_MODEL;
  const asset = await saveImageFromBase64(
    normalizeB64(raw),
    opts.conversationId,
    prompt,
    model,
    '1:1',
    '1k',
    kind,
    undefined,
    opts.messageId
  );
  const aspect = typeof opts.item.aspect_ratio === 'string' && opts.item.aspect_ratio.trim()
    ? opts.item.aspect_ratio.trim()
    : nearestAspect(asset.width, asset.height);
  const resolution = typeof opts.item.resolution === 'string' && opts.item.resolution.trim()
    ? opts.item.resolution.trim()
    : resolutionFromPixels(asset.width, asset.height);
  const call = storedImageCall(opts.item, asset.id);
  const updated = updateImage(asset.id, {
    aspect_ratio: aspect,
    resolution,
    quality: typeof opts.item.quality === 'string' ? opts.item.quality : null,
    n_index: opts.nIndex,
    extra_json: {
      source: 'chat',
      provider: 'grok',
      tool: 'image_generation',
      chat_model: opts.chatModel,
      response_id: opts.responseId || null,
      call,
    },
  });
  return { asset: updated || { ...asset, aspect_ratio: aspect, resolution }, call };
}
