import { NextResponse } from 'next/server';
import { editImages } from '@/app/lib/providers/image-edit';
import { ProviderError } from '@/app/lib/providers/image-generate';

export async function POST(req: Request) {
  const { prompt, image_id, n = 1, aspect_ratio = 'auto', resolution = '1k', conversation_id } = await req.json();
  if (!conversation_id || !image_id) {
    return NextResponse.json({ error: 'conversation_id and image_id required' }, { status: 400 });
  }

  try {
    const result = await editImages({
      prompt,
      image_id,
      n,
      aspect_ratio,
      resolution,
      conversation_id,
    });
    return NextResponse.json(result);
  } catch (e: any) {
    if (e instanceof ProviderError) {
      return NextResponse.json({ error: e.message, body: e.body, mode: (e.body as any)?.mode }, { status: e.status });
    }
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
}
