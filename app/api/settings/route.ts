import { NextResponse } from 'next/server';
import { getAllSettings, setSetting } from '@/app/lib/db';
import {
  resolveActiveBackends,
  resolveChatBackend,
  resolveImageEditBackend,
  resolveImageGenerateBackend,
} from '@/app/lib/backends';
import { INTEGRATIONS } from '@/app/lib/integrations/catalog';
import { ensureDefaultVendor, listBindings, listVendors } from '@/app/lib/vendors';
import { accessEnabled } from '@/lib/access';
import { APP_VERSION } from '@/app/lib/version';

const DEFAULTS: Record<string, string> = {
  base_url: process.env.GROK_BASE_URL || 'http://127.0.0.1:3000/v1',
  api_key: process.env.GROK_API_KEY || '',
  chat_model: process.env.CHAT_MODEL || 'grok-latest',
  image_model: process.env.IMAGE_MODEL || 'grok-imagine-image-2.0',
  default_aspect_ratio: '1:1',
  default_resolution: '1k',
  default_n: '1',
  edit_compatibility_mode: 'json',
  chat_provider: process.env.CHAT_PROVIDER || 'grok',
  chat_base_url: process.env.CHAT_BASE_URL || '',
  chat_api_key: process.env.CHAT_API_KEY || '',
  image_generate_provider: process.env.IMAGE_GENERATE_PROVIDER || 'grok',
  image_generate_base_url: process.env.IMAGE_GENERATE_BASE_URL || '',
  image_generate_api_key: process.env.IMAGE_GENERATE_API_KEY || '',
  image_generate_model: process.env.IMAGE_GENERATE_MODEL || '',
  image_edit_provider: process.env.IMAGE_EDIT_PROVIDER || 'grok',
  image_edit_base_url: process.env.IMAGE_EDIT_BASE_URL || '',
  image_edit_api_key: process.env.IMAGE_EDIT_API_KEY || '',
  image_edit_model: process.env.IMAGE_EDIT_MODEL || '',
  jetson_gateway_url: process.env.JETSON_GATEWAY_URL || '',
  jetson_api_key: process.env.JETSON_API_KEY || '',
  jetson_steps: process.env.JETSON_STEPS || '',
  jetson_seed: process.env.JETSON_SEED || '',
};

export async function GET() {
  const dbSettings = getAllSettings();
  const settings = { ...DEFAULTS, ...dbSettings };
  ensureDefaultVendor();
  const chat = resolveChatBackend();
  const generate = resolveImageGenerateBackend();
  const edit = resolveImageEditBackend();
  const active = resolveActiveBackends();
  return NextResponse.json({
    ...settings,
    resolved_chat_base_url: chat.baseUrl,
    resolved_chat_provider: chat.provider,
    resolved_image_generate_base_url: generate.provider === 'imagen' ? generate.jetsonGatewayUrl : generate.baseUrl,
    resolved_image_generate_provider: generate.provider,
    resolved_image_edit_base_url: edit.baseUrl,
    resolved_image_edit_provider: edit.provider,
    active,
    kinds: INTEGRATIONS,
    vendors: listVendors().map((v) => ({ ...v, api_key: v.api_key ? '********' : '' })),
    bindings: listBindings(),
    auth_required: accessEnabled(),
    app_version: APP_VERSION,
  });
}

export async function POST(req: Request) {
  const body = await req.json();
  Object.entries(body).forEach(([k, v]) => {
    if (typeof v !== 'string') return;
    if (k.startsWith('resolved_') || k === 'active' || k === 'vendors' || k === 'bindings' || k === 'kinds' || k === 'auth_required' || k === 'app_version') return;
    setSetting(k, v);
  });
  return NextResponse.json({ ok: true });
}
