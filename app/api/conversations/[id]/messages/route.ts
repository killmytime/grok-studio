import { NextResponse } from 'next/server';
import { listMessages, addMessage, getConversation, getDb } from '@/app/lib/db';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const msgs = listMessages(id);
  return NextResponse.json(msgs);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { role, content, extra, status, error_message } = await req.json();
  if (!getConversation(id)) return NextResponse.json({ error: 'Conv not found' }, { status: 404 });
  const msg = addMessage(id, role, content, extra, status, error_message);
  return NextResponse.json(msg);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { messageId } = await req.json();
  if (!messageId) return NextResponse.json({ error: 'messageId required' }, { status: 400 });
  const db = getDb();
  db.prepare(`DELETE FROM messages WHERE id = ? AND conversation_id = ?`).run(messageId, id);
  return NextResponse.json({ success: true });
}
