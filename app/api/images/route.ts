import { NextResponse } from 'next/server';
import { listAllImages } from '@/app/lib/db';

const KINDS = new Set(['generate', 'edit', 'upload']);
const STATUSES = new Set(['completed', 'pending', 'error', 'all']);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const kind = url.searchParams.get('kind') || undefined;
  const conversation_id = url.searchParams.get('conversation_id') || undefined;
  const q = url.searchParams.get('q')?.trim() || undefined;
  const status = url.searchParams.get('status') || undefined;
  const limit = Number(url.searchParams.get('limit') || 240);
  const offset = Number(url.searchParams.get('offset') || 0);

  if (kind && !KINDS.has(kind)) {
    return NextResponse.json({ error: 'invalid kind' }, { status: 400 });
  }
  if (status && !STATUSES.has(status)) {
    return NextResponse.json({ error: 'invalid status' }, { status: 400 });
  }

  return NextResponse.json(listAllImages({
    kind,
    conversation_id: conversation_id || undefined,
    q,
    status,
    limit: Number.isFinite(limit) ? limit : 240,
    offset: Number.isFinite(offset) ? offset : 0,
  }));
}
