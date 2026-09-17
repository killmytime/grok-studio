import { NextResponse } from 'next/server';
import { getSetting } from '@/app/lib/db';

export async function POST(req: Request) {
  const { type } = await req.json(); // 'chat' | 'image'
  const base = getSetting('base_url', process.env.GROK_BASE_URL || '');
  const key = getSetting('api_key', process.env.GROK_API_KEY || '');
  if (!base || !key) {
    return NextResponse.json({ ok: false, error: 'Base URL or API Key not set' }, { status: 400 });
  }

  try {
    if (type === 'chat') {
      const model = getSetting('chat_model', 'grok-latest');
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 5,
          stream: false,
        }),
      });
      const data = await res.json();
      return NextResponse.json({ ok: res.ok, status: res.status, body: data });
    } else {
      const model = getSetting('image_model', 'grok-imagine-image-2.0');
      const res = await fetch(`${base}/images/generations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          prompt: 'test',
          n: 1,
          aspect_ratio: '1:1',
          resolution: '1k',
        }),
      });
      const data = await res.json();
      return NextResponse.json({ ok: res.ok, status: res.status, body: data });
    }
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
