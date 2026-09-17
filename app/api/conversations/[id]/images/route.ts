import { NextResponse } from 'next/server';
import { listImages } from '@/app/lib/db';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const imgs = listImages(id);
  return NextResponse.json(imgs);
}
