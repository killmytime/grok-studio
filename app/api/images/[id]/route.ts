import { NextResponse } from 'next/server';
import { deleteImage, getImage } from '@/app/lib/db';
import { cancelPendingImage, reconcilePendingImage } from '@/app/lib/providers/image-generate';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Missing image id' }, { status: 400 });

  let img = getImage(id);
  if (!img) return NextResponse.json({ error: 'Image not found' }, { status: 404 });

  if (img.status === 'pending' && img.job_id) {
    img = (await reconcilePendingImage(img)) || img;
  }
  return NextResponse.json(img);
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: 'Missing image id' }, { status: 400 });
  }

  try {
    const img = getImage(id);
    if (!img) {
      return NextResponse.json({ error: 'Image not found' }, { status: 404 });
    }

    if (img.status === 'pending' && img.job_id) {
      await cancelPendingImage(img);
    }

    const success = deleteImage(id);
    if (!success) {
      return NextResponse.json({ error: 'Failed to delete image' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
