import { NextResponse } from 'next/server';
import { listMessages, addMessage, getConversation } from '@/app/lib/db';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const msgs = listMessages(id);
  return NextResponse.json(msgs);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { role, content, extra } = await req.json();
  if (!getConversation(id)) return NextResponse.json({ error: 'Conv not found' }, { status: 404 });
  const msg = addMessage(id, role, content, extra);
  return NextResponse.json(msg);
}
