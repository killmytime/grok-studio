import { NextResponse } from 'next/server';
import { getConversation, listMessages } from '@/app/lib/db';
import { runConversationSummary } from '@/app/lib/summarize';
import { usableTurns } from '@/app/lib/chat-context';
import { assertChatConfigured, fetchChatCompletions } from '@/app/lib/providers/chat';
import { resolveChatBackend } from '@/app/lib/backends';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const conv = getConversation(id);
  if (!conv) return NextResponse.json({ error: 'Conv not found' }, { status: 404 });

  let body: { messages?: any[]; prompt?: string } = {};
  try {
    body = await req.json();
  } catch {}

  if (body.prompt) {
    const backend = resolveChatBackend();
    const configured = assertChatConfigured(backend);
    if (configured) return NextResponse.json({ error: configured }, { status: 400 });

    const source = Array.isArray(body.messages) && body.messages.length
      ? body.messages
      : usableTurns(listMessages(id));
    if (source.length < 1) return NextResponse.json({ summary: null });

    const historyText = source
      .slice(0, 8)
      .map((m: any) => `${m.role}: ${m.content}`)
      .join('\n');

    try {
      const res = await fetchChatCompletions({
        messages: [
          { role: 'system', content: body.prompt },
          { role: 'user', content: historyText },
        ],
        max_tokens: 40,
        temperature: 0.3,
        stream: false,
      }, backend);
      if (!res.ok) {
        const errText = await res.text();
        return NextResponse.json({ error: `Upstream error: ${res.status}`, body: errText }, { status: 502 });
      }
      const data = await res.json();
      const summary = data.choices?.[0]?.message?.content?.trim() || null;
      return NextResponse.json({ summary });
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: e.status || 500 });
    }
  }

  try {
    const summary = await runConversationSummary(id);
    return NextResponse.json({ summary });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
}
