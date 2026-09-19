import { NextResponse } from 'next/server';
import { getImage } from '@/app/lib/db';
import { cancelPendingImage } from '@/app/lib/providers/image-generate';

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Missing image id' }, { status: 400 });

  const img = getImage(id);
  if (!img) return NextResponse.json({ error: 'Image not found' }, { status: 404 });

  const updated = await cancelPendingImage(img);
  return NextResponse.json(updated);
}
