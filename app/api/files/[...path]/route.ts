import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const DATA_DIR = process.env.DATA_DIR || './data';

export async function GET(_: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const relative = path.join('/');
  const fullPath = join(/* turbopackIgnore: true */ DATA_DIR, relative);
  if (!existsSync(/* turbopackIgnore: true */ fullPath)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const buffer = readFileSync(/* turbopackIgnore: true */ fullPath);
  const ext = relative.split('.').pop() || 'png';
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': mime,
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
