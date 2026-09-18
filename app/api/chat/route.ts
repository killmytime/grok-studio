import { NextResponse } from 'next/server';
import { getSetting, addMessage, getConversation, updateMessageStatus } from '@/app/lib/db';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { conversation_id, messages, model: overrideModel, pendingMessageId } = await req.json();

  if (!conversation_id) return NextResponse.json({ error: 'conversation_id required' }, { status: 400 });
  if (!getConversation(conversation_id)) return NextResponse.json({ error: 'Conv not found' }, { status: 404 });

  const base = getSetting('base_url', process.env.GROK_BASE_URL || '');
  const key = getSetting('api_key', process.env.GROK_API_KEY || '');
  const model = overrideModel || getSetting('chat_model', process.env.CHAT_MODEL || 'grok-latest');
  const temperature = parseFloat(getSetting('temperature', '0.7'));
  const maxTokens = parseInt(getSetting('max_tokens', '4096'));

  if (!base || !key) return NextResponse.json({ error: 'API not configured' }, { status: 400 });

  const limited = messages.slice(-16);

  const upstreamBody = {
    model,
    messages: limited,
    stream: true,
    temperature: isNaN(temperature) ? 0.7 : temperature,
    max_tokens: isNaN(maxTokens) ? 4096 : maxTokens,
  };

  try {
    const upstream = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(upstreamBody),
    });

    if (!upstream.ok || !upstream.body) {
      const errText = await upstream.text();
      if (pendingMessageId) {
        updateMessageStatus(pendingMessageId, 'error', '', `上游错误: ${upstream.status}`);
      }
      return NextResponse.json({ error: 'Upstream error', status: upstream.status, body: errText }, { status: 502 });
    }

    const encoder = new TextEncoder();
    let assistantContent = '';

    const stream = new ReadableStream({
      async start(controller) {
        const reader = upstream.body!.getReader();
        const decoder = new TextDecoder();

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            controller.enqueue(encoder.encode(chunk));

            const lines = chunk.split('\n');
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const jsonStr = line.slice(6).trim();
                if (jsonStr === '[DONE]') continue;
                try {
                  const data = JSON.parse(jsonStr);
                  const delta = data.choices?.[0]?.delta?.content;
                  if (delta) assistantContent += delta;
                } catch {}
              }
            }
          }
        } catch (e) {
          controller.error(e);
        } finally {
          if (assistantContent.trim()) {
            if (pendingMessageId) {
              updateMessageStatus(pendingMessageId, 'completed', assistantContent.trim());
            } else {
              addMessage(conversation_id, 'assistant', assistantContent.trim(), { model });
            }
          } else if (pendingMessageId) {
            updateMessageStatus(pendingMessageId, 'error', '', '模型返回为空');
          }
          controller.close();
        }
      },
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (e: any) {
    if (pendingMessageId) {
      updateMessageStatus(pendingMessageId, 'error', '', e.message);
    }
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
