import { NextResponse } from 'next/server';
import { getVendor, addOrReplaceVendorModel, setBinding } from '@/app/lib/vendors';
import { ttsServiceRoot, type SpeechBackend } from '@/app/lib/backends';
import { cloneSpeakerPt } from '@/app/lib/providers/tts';
import { saveSpeakerPt } from '@/app/lib/audio';

function sanitizeName(raw: string) {
  const s = raw.trim().replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, '').slice(0, 40);
  return s || 'speaker';
}

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: '需要 multipart 表单' }, { status: 400 });
  const vendorId = String(form.get('vendor_id') || '');
  const name = sanitizeName(String(form.get('name') || 'speaker'));
  const file = form.get('ref_audio');
  if (!vendorId) return NextResponse.json({ error: 'vendor_id required' }, { status: 400 });
  if (!(file instanceof File) || file.size < 100) {
    return NextResponse.json({ error: '请上传一段参考音频（wav/mp3）' }, { status: 400 });
  }
  const vendor = getVendor(vendorId);
  if (!vendor) return NextResponse.json({ error: 'vendor not found' }, { status: 404 });

  const backend: SpeechBackend = {
    provider: 'qwen3tts',
    baseUrl: ttsServiceRoot(vendor.base_url),
    apiKey: vendor.api_key,
    model: 'tts-1',
    voice: 'dynamic',
    language: String(vendor.extra?.language || ''),
    instruct: String(vendor.extra?.instruct || ''),
    seed: String(vendor.extra?.seed || ''),
  };

  try {
    const pt = await cloneSpeakerPt({
      backend,
      refAudio: Buffer.from(await file.arrayBuffer()),
      filename: `${name}.pt`,
    });
    const rel = saveSpeakerPt(vendor.id, name, pt);
    const updated = addOrReplaceVendorModel(vendor.id, {
      model: name,
      capabilities: ['speech'],
      extra: { speaker_pt: rel },
    });
    setBinding('speech', vendor.id, name);
    return NextResponse.json({
      ok: true,
      voice: name,
      speaker_pt: rel,
      vendor: { ...updated, api_key: updated.api_key ? '********' : '' },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
}
