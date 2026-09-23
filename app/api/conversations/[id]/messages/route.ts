import { NextResponse } from 'next/server';
import {
  listMessages,
  addMessage,
  getConversation,
  getDb,
  getMessage,
  updateMessageContent,
  updateMessageStatus,
  deleteMessagesAfter,
} from '@/app/lib/db';

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

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { messageId, content, status, error_message } = await req.json();
  if (!messageId) return NextResponse.json({ error: 'messageId required' }, { status: 400 });
  const msg = getMessage(messageId);
  if (!msg || msg.conversation_id !== id) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (status === 'pending' || status === 'completed' || status === 'error') {
    updateMessageStatus(messageId, status, content, error_message);
    return NextResponse.json(getMessage(messageId));
  }
  if (content == null) return NextResponse.json({ error: 'content required' }, { status: 400 });
  return NextResponse.json(updateMessageContent(messageId, String(content)));
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { messageId, after } = await req.json();
  if (!messageId) return NextResponse.json({ error: 'messageId required' }, { status: 400 });
  if (after) {
    deleteMessagesAfter(id, messageId, false);
    return NextResponse.json({ success: true });
  }
  const db = getDb();
  db.prepare(`DELETE FROM messages WHERE id = ? AND conversation_id = ?`).run(messageId, id);
  return NextResponse.json({ success: true });
}
