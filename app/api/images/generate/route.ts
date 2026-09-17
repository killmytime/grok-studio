import { NextResponse } from 'next/server';
import { getSetting } from '@/app/lib/db';
import { saveImageFromUrl, saveImageFromBase64 } from '@/app/lib/image';

export async function POST(req: Request) {
  const { prompt, n = 1, aspect_ratio = '1:1', resolution = '1k', conversation_id, quality } = await req.json();
  if (!conversation_id) return NextResponse.json({ error: 'conversation_id required' }, { status: 400 });

  const base = getSetting('base_url', process.env.GROK_BASE_URL || '');
  const key = getSetting('api_key', process.env.GROK_API_KEY || '');
  const model = getSetting('image_model', process.env.IMAGE_MODEL || 'grok-imagine-image-2.0');
  if (!base || !key) return NextResponse.json({ error: 'API not configured' }, { status: 400 });

  const body: any = {
    model,
    prompt,
    n: Math.min(Math.max(1, parseInt(n)), 4),
    aspect_ratio,
    resolution,
  };
  if (quality) body.quality = quality;

  try {
    const res = await fetch(`${base}/images/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json({ error: 'Upstream error', status: res.status, body: data }, { status: 502 });
    }

    const assets: any[] = [];

    // 自动解包中转常见格式：{ ok, status, body: { data: [...] } } 或直接返回上游
    let upstream = data;
    if (data && typeof data === 'object' && 'body' in data && data.body) {
      upstream = data.body;
    }

    let items: any[] = [];
    if (Array.isArray(upstream)) items = upstream;
    else if (upstream.data && Array.isArray(upstream.data)) items = upstream.data;
    else if (upstream.images && Array.isArray(upstream.images)) items = upstream.images;
    else if (upstream.b64_json || upstream.url) items = [upstream];
    else if (upstream.result) items = Array.isArray(upstream.result) ? upstream.result : [upstream.result];

    for (const item of items) {
      const b64 = item.b64_json || item.base64 || item.image_base64 || (typeof item === 'string' ? item : null);
      let asset;
      if (b64) {
        asset = await saveImageFromBase64(b64, conversation_id, prompt, model, aspect_ratio, resolution, 'generate', undefined, undefined, item.mime || 'image/png');
      } else if (item.url) {
        asset = await saveImageFromUrl(item.url, conversation_id, prompt, model, aspect_ratio, resolution, 'generate');
      } else if (item.image) {
        asset = await saveImageFromBase64(item.image, conversation_id, prompt, model, aspect_ratio, resolution, 'generate');
      }
      if (asset) assets.push(asset);
    }
    return NextResponse.json({ images: assets });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
