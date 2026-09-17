import { NextResponse } from 'next/server';
import { getAllSettings, setSetting, getSetting } from '@/app/lib/db';

const DEFAULTS = {
  base_url: process.env.GROK_BASE_URL || 'http://127.0.0.1:3000/v1',
  api_key: process.env.GROK_API_KEY || '',
  chat_model: process.env.CHAT_MODEL || 'grok-latest',
  image_model: process.env.IMAGE_MODEL || 'grok-imagine-image-2.0',
  default_aspect_ratio: '1:1',
  default_resolution: '1k',
  default_n: '1',
  edit_compatibility_mode: 'json',
};

export async function GET() {
  const dbSettings = getAllSettings();
  const settings = { ...DEFAULTS, ...dbSettings };
  return NextResponse.json(settings);
}

export async function POST(req: Request) {
  const body = await req.json();
  Object.entries(body).forEach(([k, v]) => {
    if (typeof v === 'string') setSetting(k, v);
  });
  return NextResponse.json({ ok: true });
}
