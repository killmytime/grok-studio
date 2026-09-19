import { getSetting } from './db';
import {
  canonicalIntegrationId,
  getIntegration,
  hasCapability,
  type ActiveBackends,
  type Capability,
} from './integrations/catalog';
import { getBinding, getVendor, type Vendor } from './vendors';

export type ChatProviderId = 'grok' | 'ollama';
export type ImageGenerateProviderId = 'grok' | 'imagen' | 'jetson';

export interface CapabilityBackend {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ImageGenerateBackend extends CapabilityBackend {
  jetsonGatewayUrl: string;
  jetsonApiKey: string;
  jetsonSteps: string;
  jetsonSeed: string;
}

export const JETSON_DEFAULT_MODEL = 'sd-cpp-local';

export function normalizeImagenBaseUrl(url: string): string {
  const trimmed = url.replace(/\/+$/, '');
  if (!trimmed) return '';
  if (/\/v1$/i.test(trimmed)) return trimmed;
  return `${trimmed}/v1`;
}

/** Qwen3TTS health is /health, speech is /v1/audio/speech — root has no required /v1 suffix. */
export function ttsServiceRoot(url: string): string {
  return (url || '').replace(/\/+$/, '').replace(/\/v1$/i, '');
}

export interface SpeechBackend extends CapabilityBackend {
  voice: string;
  language: string;
  instruct: string;
  seed: string;
  speakerPt?: string;
}

function firstNonEmpty(...vals: Array<string | undefined | null>): string {
  for (const v of vals) {
    if (v && v.trim()) return v.trim();
  }
  return '';
}

export function grokFallbackBaseUrl(): string {
  return firstNonEmpty(getSetting('base_url', ''), process.env.GROK_BASE_URL);
}

export function grokFallbackApiKey(): string {
  return firstNonEmpty(getSetting('api_key', ''), process.env.GROK_API_KEY);
}

export function normalizeChatBaseUrl(url: string, provider: string): string {
  const trimmed = url.replace(/\/+$/, '');
  if (!trimmed) return '';
  if (provider === 'ollama' && !/\/v1$/i.test(trimmed)) {
    return `${trimmed}/v1`;
  }
  return trimmed;
}

function vendorForCapability(cap: Capability): { vendor: Vendor; model: string } | null {
  const binding = getBinding(cap);
  if (!binding) return null;
  const vendor = getVendor(binding.vendor_id);
  if (!vendor) return null;
  return { vendor, model: binding.model };
}

function fromVendor(vendor: Vendor, model: string, cap: Capability): CapabilityBackend {
  const kind = canonicalIntegrationId(vendor.kind);
  const integration = getIntegration(kind);
  let baseUrl = vendor.base_url;
  let apiKey = vendor.api_key;
  if (kind === 'grok') {
    baseUrl = firstNonEmpty(baseUrl, grokFallbackBaseUrl());
    apiKey = firstNonEmpty(apiKey, grokFallbackApiKey());
  }
  if (kind === 'ollama') baseUrl = normalizeChatBaseUrl(baseUrl, 'ollama');
  if (kind === 'imagen') baseUrl = normalizeImagenBaseUrl(baseUrl);
  if (kind === 'qwen3tts') baseUrl = ttsServiceRoot(baseUrl);
  const resolvedModel = firstNonEmpty(model, integration.defaultModels[cap], model);
  return { provider: kind, baseUrl, apiKey, model: resolvedModel };
}

export function resolveChatBackend(): CapabilityBackend {
  const overrideUrl = getSetting('chat_base_url', '');
  const overrideKey = getSetting('chat_api_key', '');
  if (!overrideUrl && !overrideKey) {
    const bound = vendorForCapability('chat');
    if (bound) return fromVendor(bound.vendor, bound.model, 'chat');
  }

  const provider = canonicalIntegrationId(
    firstNonEmpty(getSetting('chat_provider', ''), process.env.CHAT_PROVIDER, 'grok')
  );
  const integration = getIntegration(provider);

  const baseUrl = firstNonEmpty(
    getSetting('chat_base_url', ''),
    process.env.CHAT_BASE_URL,
    grokFallbackBaseUrl()
  );

  const apiKey = integration.requiresApiKey
    ? firstNonEmpty(getSetting('chat_api_key', ''), process.env.CHAT_API_KEY, grokFallbackApiKey())
    : firstNonEmpty(getSetting('chat_api_key', ''), process.env.CHAT_API_KEY);

  const model = firstNonEmpty(
    getSetting('chat_model', ''),
    process.env.CHAT_MODEL,
    integration.defaultModels.chat,
    'grok-latest'
  );

  return { provider, baseUrl: normalizeChatBaseUrl(baseUrl, provider), apiKey, model };
}

export function resolveImageGenerateBackend(): ImageGenerateBackend {
  const hasOverride = !!(
    getSetting('image_generate_base_url', '') ||
    getSetting('jetson_gateway_url', '') ||
    getSetting('image_generate_api_key', '')
  );
  if (!hasOverride) {
    const bound = vendorForCapability('image.generate');
    if (bound) {
      const core = fromVendor(bound.vendor, bound.model, 'image.generate');
      const extra = bound.vendor.extra || {};
      const imagenUrl = core.provider === 'imagen' ? normalizeImagenBaseUrl(core.baseUrl) : '';
      return {
        ...core,
        jetsonGatewayUrl: imagenUrl,
        jetsonApiKey: core.provider === 'imagen' ? core.apiKey : '',
        jetsonSteps: String(extra.steps ?? extra.jetson_steps ?? ''),
        jetsonSeed: String(extra.seed ?? extra.jetson_seed ?? ''),
      };
    }
  }

  const provider = canonicalIntegrationId(
    firstNonEmpty(getSetting('image_generate_provider', ''), process.env.IMAGE_GENERATE_PROVIDER, 'grok')
  );
  const integration = getIntegration(provider);

  const baseUrl = firstNonEmpty(
    getSetting('image_generate_base_url', ''),
    process.env.IMAGE_GENERATE_BASE_URL,
    grokFallbackBaseUrl()
  );

  const apiKey = integration.requiresApiKey
    ? firstNonEmpty(getSetting('image_generate_api_key', ''), process.env.IMAGE_GENERATE_API_KEY, grokFallbackApiKey())
    : firstNonEmpty(getSetting('image_generate_api_key', ''), process.env.IMAGE_GENERATE_API_KEY);

  const model = firstNonEmpty(
    getSetting('image_generate_model', ''),
    process.env.IMAGE_GENERATE_MODEL,
    provider === 'imagen' ? process.env.JETSON_MODEL : '',
    provider === 'grok' ? getSetting('image_model', '') : '',
    provider === 'grok' ? process.env.IMAGE_MODEL : '',
    integration.defaultModels['image.generate'],
    'grok-imagine-image-2.0'
  );

  const jetsonGatewayUrl = normalizeImagenBaseUrl(
    firstNonEmpty(
      getSetting('jetson_gateway_url', ''),
      process.env.JETSON_GATEWAY_URL,
      process.env.IMAGEN_BASE_URL
    )
  );

  const jetsonApiKey = firstNonEmpty(
    getSetting('jetson_api_key', ''),
    process.env.JETSON_API_KEY,
    process.env.IMAGEN_API_KEY
  );

  const jetsonSteps = firstNonEmpty(getSetting('jetson_steps', ''), process.env.JETSON_STEPS);
  const jetsonSeed = firstNonEmpty(getSetting('jetson_seed', ''), process.env.JETSON_SEED);

  return { provider, baseUrl, apiKey, model, jetsonGatewayUrl, jetsonApiKey, jetsonSteps, jetsonSeed };
}

export function resolveImageEditBackend(): CapabilityBackend {
  const hasOverride = !!(getSetting('image_edit_base_url', '') || getSetting('image_edit_api_key', ''));
  if (!hasOverride) {
    const bound = vendorForCapability('image.edit');
    if (bound) return fromVendor(bound.vendor, bound.model, 'image.edit');
  }

  const provider = canonicalIntegrationId(
    firstNonEmpty(getSetting('image_edit_provider', ''), process.env.IMAGE_EDIT_PROVIDER, 'grok')
  );
  const integration = getIntegration(provider);

  const baseUrl = firstNonEmpty(
    getSetting('image_edit_base_url', ''),
    process.env.IMAGE_EDIT_BASE_URL,
    grokFallbackBaseUrl()
  );

  const apiKey = integration.requiresApiKey
    ? firstNonEmpty(getSetting('image_edit_api_key', ''), process.env.IMAGE_EDIT_API_KEY, grokFallbackApiKey())
    : firstNonEmpty(getSetting('image_edit_api_key', ''), process.env.IMAGE_EDIT_API_KEY);

  const model = firstNonEmpty(
    getSetting('image_edit_model', ''),
    process.env.IMAGE_EDIT_MODEL,
    getSetting('image_model', ''),
    process.env.IMAGE_MODEL,
    integration.defaultModels['image.edit'],
    'grok-imagine-image-2.0'
  );

  return { provider, baseUrl, apiKey, model };
}

export function resolveSpeechBackend(): SpeechBackend | null {
  const bound = vendorForCapability('speech');
  if (bound) {
    const core = fromVendor(bound.vendor, bound.model, 'speech');
    const extra = bound.vendor.extra || {};
    const modelRow = bound.vendor.models.find((m) => m.model === bound.model);
    const speakerPt = String(modelRow?.extra?.speaker_pt || extra.speaker_pt || '');
    return {
      ...core,
      voice: bound.model || String(extra.default_voice || ''),
      language: String(extra.language ?? ''),
      instruct: String(extra.instruct ?? ''),
      seed: String(extra.seed ?? ''),
      speakerPt: speakerPt || undefined,
    };
  }
  const url = ttsServiceRoot(firstNonEmpty(getSetting('tts_base_url', ''), process.env.TTS_BASE_URL));
  if (!url) return null;
  return {
    provider: 'qwen3tts',
    baseUrl: url,
    apiKey: firstNonEmpty(getSetting('tts_api_key', ''), process.env.TTS_API_KEY),
    model: 'tts-1',
    voice: firstNonEmpty(getSetting('tts_voice', ''), process.env.TTS_VOICE),
    language: firstNonEmpty(getSetting('tts_language', ''), process.env.TTS_LANGUAGE),
    instruct: firstNonEmpty(getSetting('tts_instruct', ''), process.env.TTS_INSTRUCT),
    seed: firstNonEmpty(getSetting('tts_seed', ''), process.env.TTS_SEED),
    speakerPt: firstNonEmpty(getSetting('tts_speaker_pt', ''), process.env.TTS_SPEAKER_PT) || undefined,
  };
}

export function resolveActiveBackends(): ActiveBackends {
  const chat = resolveChatBackend();
  const generate = resolveImageGenerateBackend();
  const edit = resolveImageEditBackend();
  const chatI = getIntegration(chat.provider);
  const genI = getIntegration(generate.provider);
  const editI = getIntegration(edit.provider);
  const editCapable = hasCapability(edit.provider, 'image.edit');
  const editConfigured = !!(edit.baseUrl && (!editI.requiresApiKey || edit.apiKey));
  const speech = resolveSpeechBackend();
  const speechI = speech ? getIntegration(speech.provider) : null;
  const speechOk = !!(speech?.baseUrl && speechI && hasCapability(speechI.id, 'speech'));
  return {
    chat: { integration: chatI.id, label: chatI.label, model: chat.model, capabilities: [...chatI.capabilities] },
    generate: {
      integration: genI.id,
      label: genI.label,
      model: generate.model,
      capabilities: [...genI.capabilities],
      supportsEdit: hasCapability(generate.provider, 'image.edit'),
    },
    edit: {
      integration: editI.id,
      label: editI.label,
      model: edit.model,
      capabilities: [...editI.capabilities],
      available: editCapable && editConfigured,
      reason: !editCapable ? `${editI.label} 不支持改图` : !editConfigured ? '改图后端未配置' : undefined,
    },
    speech: {
      integration: speechOk ? speechI!.id : '',
      label: speechOk ? speechI!.label : '未配置',
      model: speechOk ? speech!.voice : '',
      capabilities: speechOk ? [...speechI!.capabilities] : [],
      available: speechOk,
      reason: speechOk ? undefined : '未绑定朗读供应商',
    },
  };
}

export function bearerHeaders(apiKey: string, extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extra,
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}
