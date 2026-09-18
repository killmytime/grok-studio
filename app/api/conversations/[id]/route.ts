import { NextResponse } from 'next/server';
import { getConversation, deleteConversation, updateConversation, updateConversationSummary } from '@/app/lib/db';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const conv = getConversation(id);
  if (!conv) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(conv);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  if (body.summary) {
    updateConversationSummary(id, body.summary);
  } else if (body.title) {
    updateConversation(id, { title: body.title });
  } else {
    return NextResponse.json({ error: 'title or summary required' }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  deleteConversation(id);
  return NextResponse.json({ ok: true });
}
