import { NextResponse } from 'next/server';
import { listImages } from '@/app/lib/db';
import { reconcilePendingImage } from '@/app/lib/providers/image-generate';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const imgs = listImages(id);
  for (const img of imgs) {
    if (img.status === 'pending' && img.job_id) {
      await reconcilePendingImage(img);
    }
  }
  return NextResponse.json(listImages(id));
}
