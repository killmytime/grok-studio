import { NextResponse } from 'next/server';
import { generateImages, ProviderError } from '@/app/lib/providers/image-generate';

export async function POST(req: Request) {
  const { prompt, n = 1, aspect_ratio = '1:1', resolution = '1k', conversation_id, quality, negative_prompt } = await req.json();
  if (!conversation_id) return NextResponse.json({ error: 'conversation_id required' }, { status: 400 });
  if (!prompt) return NextResponse.json({ error: 'prompt required' }, { status: 400 });

  try {
    const result = await generateImages({
      prompt,
      n,
      aspect_ratio,
      resolution,
      conversation_id,
      quality,
      negative_prompt,
    });
    return NextResponse.json(result);
  } catch (e: any) {
    if (e instanceof ProviderError) {
      return NextResponse.json({ error: e.message, body: e.body }, { status: e.status });
    }
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
}
