import { NextResponse } from 'next/server';
import { listConversations, createConversation } from '@/app/lib/db';

export async function GET() {
  const convs = listConversations();
  return NextResponse.json(convs);
}

export async function POST(req: Request) {
  const { title } = await req.json();
  const conv = createConversation(title || '新会话');
  return NextResponse.json(conv);
}
