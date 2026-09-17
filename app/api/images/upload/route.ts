import { NextResponse } from 'next/server';
import { saveImageFromBase64 } from '@/app/lib/image';

export async function POST(req: Request) {
  const { conversation_id, b64, prompt = '上传的参考图', mime = 'image/png' } = await req.json();
  if (!conversation_id || !b64) return NextResponse.json({ error: 'Missing data' }, { status: 400 });

  try {
    const asset = await saveImageFromBase64(b64, conversation_id, prompt, 'upload', 'auto', '1k', 'upload');
    return NextResponse.json({ image: asset });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
