import { NextResponse } from 'next/server';
import { getConversation, getSetting } from '@/app/lib/db';
import { assertChatConfigured, fetchChatCompletions } from '@/app/lib/providers/chat';
import { resolveChatBackend } from '@/app/lib/backends';

const DEFAULT_SUMMARY_PROMPT = `请用中文将以下对话历史压缩成一段简洁的摘要（200-300字以内），保留：
- 用户的核心偏好、设定、角色关系
- 已讨论的重要事实和决定
- 当前的剧情/任务进度
不要添加多余的解释，直接输出摘要正文。`;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const conv = getConversation(id);
  if (!conv) return NextResponse.json({ error: 'Conv not found' }, { status: 404 });

  const { messages: allMessages, prompt } = await req.json();
  const summaryPrompt = prompt || getSetting('summary_prompt', DEFAULT_SUMMARY_PROMPT);

  if (!allMessages || allMessages.length < 10) {
    return NextResponse.json({ summary: null });
  }

  const middle = allMessages.slice(3, -6);
  if (middle.length < 6) {
    return NextResponse.json({ summary: null });
  }

  const historyText = middle.map((m: any) => `${m.role}: ${m.content}`).join('\n');
  const backend = resolveChatBackend();
  const configured = assertChatConfigured(backend);
  if (configured) {
    return NextResponse.json({ error: configured }, { status: 400 });
  }

  try {
    const res = await fetchChatCompletions({
      messages: [
        { role: 'system', content: summaryPrompt },
        { role: 'user', content: historyText },
      ],
      max_tokens: 400,
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
