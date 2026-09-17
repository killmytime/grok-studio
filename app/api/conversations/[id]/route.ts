import { NextResponse } from 'next/server';
import { getConversation, deleteConversation, updateConversation } from '@/app/lib/db';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const conv = getConversation(id);
  if (!conv) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(conv);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { title } = await req.json();
  if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 });
  updateConversation(id, { title });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  deleteConversation(id);
  return NextResponse.json({ ok: true });
}
