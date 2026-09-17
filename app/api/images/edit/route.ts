import { NextResponse } from 'next/server';
import { getSetting, getImage } from '@/app/lib/db';
import { saveImageFromUrl, saveImageFromBase64, imageToDataUri } from '@/app/lib/image';

export async function POST(req: Request) {
  const { prompt, image_id, n = 1, aspect_ratio = 'auto', resolution = '1k', conversation_id, parent_id } = await req.json();
  if (!conversation_id || !image_id) {
    return NextResponse.json({ error: 'conversation_id and image_id required' }, { status: 400 });
  }

  const base = getSetting('base_url', process.env.GROK_BASE_URL || '');
  const key = getSetting('api_key', process.env.GROK_API_KEY || '');
  const model = getSetting('image_model', process.env.IMAGE_MODEL || 'grok-imagine-image-2.0');
  const mode = getSetting('edit_compatibility_mode', 'json');
  if (!base || !key) return NextResponse.json({ error: 'API not configured' }, { status: 400 });

  const sourceImg = getImage(image_id);
  if (!sourceImg) return NextResponse.json({ error: 'Source image not found' }, { status: 404 });

  try {
    const dataUri = await imageToDataUri(sourceImg.file_path);

    if (mode === 'json') {
      const body = {
        model,
        prompt,
        image: { url: dataUri },
        n: Math.min(Math.max(1, parseInt(n)), 4),
        aspect_ratio,
        resolution,
      };
      const res = await fetch(`${base}/images/edits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        return NextResponse.json({ error: 'Edit failed', status: res.status, body: data, mode }, { status: 502 });
      }
      // same compatible handling
      // 自动解包中转常见格式
      let upstream = data;
      if (data && typeof data === 'object' && 'body' in data && data.body) {
        upstream = data.body;
      }

      const items = (upstream.data && Array.isArray(upstream.data)) ? upstream.data :
                    (upstream.images && Array.isArray(upstream.images)) ? upstream.images : [];

      const assets: any[] = [];
      for (const item of items) {
        const b64 = item.b64_json || item.base64 || item.image_base64;
        let asset;
        if (b64) asset = await saveImageFromBase64(b64, conversation_id, prompt, model, aspect_ratio, resolution, 'edit', image_id);
        else if (item.url) asset = await saveImageFromUrl(item.url, conversation_id, prompt, model, aspect_ratio, resolution, 'edit', image_id);
        if (asset) assets.push(asset);
      }
      return NextResponse.json({ images: assets });
    } else if (mode === 'generations') {
      // fallback: put data uri into generations extra field if supported by proxy
      const body: any = {
        model,
        prompt,
        image: dataUri,
        n: 1,
        aspect_ratio,
        resolution,
      };
      const res = await fetch(`${base}/images/generations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) return NextResponse.json({ error: 'Fallback failed', status: res.status, body: data }, { status: 502 });
      const items = data.data || [];
      const assets: any[] = [];
      for (const item of items) {
        let asset;
        if (item.b64_json) asset = await saveImageFromBase64(item.b64_json, conversation_id, prompt, model, aspect_ratio, resolution, 'edit', image_id);
        else if (item.url) asset = await saveImageFromUrl(item.url, conversation_id, prompt, model, aspect_ratio, resolution, 'edit', image_id);
        if (asset) assets.push(asset);
      }
      return NextResponse.json({ images: assets, mode: 'generations' });
    } else {
      return NextResponse.json({ error: 'Edit compatibility mode set to error only' }, { status: 400 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
