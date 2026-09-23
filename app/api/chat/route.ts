import { after, NextResponse } from 'next/server';
import { addMessage, getConversation, getConversationSummary, getMessage, getSetting, listMessages, updateMessageStatus } from '@/app/lib/db';
import { assertChatConfigured, fetchChatCompletions } from '@/app/lib/providers/chat';
import { resolveChatBackend } from '@/app/lib/backends';
import { buildChatContext, usableTurns } from '@/app/lib/chat-context';
import { maybeAutoSummarize } from '@/app/lib/summarize';
import { cancelChatJob, finishChatJob, hasChatJob, registerChatJob } from '@/app/lib/chat-jobs';
import { createSseParser, deltaFromSsePayload } from '@/app/lib/sse';

export const runtime = 'nodejs';

function keepAlive(work: Promise<unknown>) {
  try {
    after(() => work);
  } catch {
    // vitest / no Next request context — the promise still runs
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { conversation_id, messages, model: overrideModel, pendingMessageId, cancel } = body || {};

  if (cancel && pendingMessageId) {
    const existed = cancelChatJob(pendingMessageId);
    const msg = getMessage(pendingMessageId);
    if (msg?.status === 'pending' && !existed) {
      updateMessageStatus(pendingMessageId, 'error', msg.content || '', '已中断');
    }
    return NextResponse.json({ ok: true });
  }

  if (!conversation_id) return NextResponse.json({ error: 'conversation_id required' }, { status: 400 });
  if (!getConversation(conversation_id)) return NextResponse.json({ error: 'Conv not found' }, { status: 404 });

  if (pendingMessageId && hasChatJob(pendingMessageId)) {
    return NextResponse.json({ ok: true, running: true });
  }

  if (pendingMessageId) {
    const existing = getMessage(pendingMessageId);
    if (existing?.status === 'completed') {
      return NextResponse.json({ ok: true, done: true });
    }
  }

  const backend = resolveChatBackend();
  const model = overrideModel || backend.model;
  const configured = assertChatConfigured(backend);
  if (configured) return NextResponse.json({ error: configured }, { status: 400 });

  const temperature = parseFloat(getSetting('temperature', '0.7'));
  const maxTokens = parseInt(getSetting('max_tokens', '4096'));
  const dbMessages = listMessages(conversation_id);
  const source = usableTurns(dbMessages).length > 0 ? dbMessages : (Array.isArray(messages) ? messages : []);
  const limited = buildChatContext(source, getConversationSummary(conversation_id));
  const abort = pendingMessageId ? registerChatJob(pendingMessageId) : new AbortController();

  try {
    const upstream = await fetchChatCompletions(
      {
        model,
        messages: limited,
        stream: true,
        temperature: isNaN(temperature) ? 0.7 : temperature,
        max_tokens: isNaN(maxTokens) ? 4096 : maxTokens,
      },
      backend,
      { signal: abort.signal }
    );

    if (!upstream.ok || !upstream.body) {
      const errText = await upstream.text();
      if (pendingMessageId) {
        updateMessageStatus(pendingMessageId, 'error', '', `上游错误: ${upstream.status}`);
        finishChatJob(pendingMessageId);
      }
      return NextResponse.json({ error: 'Upstream error', status: upstream.status, body: errText }, { status: 502 });
    }

    const encoder = new TextEncoder();
    let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
    const queued: Uint8Array[] = [];
    let finished = false;

    function pushToClient(chunk: Uint8Array) {
      if (controllerRef) {
        try {
          controllerRef.enqueue(chunk);
        } catch {
          controllerRef = null;
        }
      } else if (!finished) {
        queued.push(chunk);
      }
    }

    function closeClient() {
      finished = true;
      queued.length = 0;
      if (!controllerRef) return;
      try {
        controllerRef.close();
      } catch {}
      controllerRef = null;
    }

    const consume = (async () => {
      const reader = upstream.body!.getReader();
      const decoder = new TextDecoder();
      const parser = createSseParser();
      let assistantContent = '';
      let interrupted = false;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          pushToClient(encoder.encode(chunk));
          for (const payload of parser.take(chunk)) {
            const delta = deltaFromSsePayload(payload);
            if (delta) assistantContent += delta;
          }
        }
        for (const payload of parser.flush()) {
          const delta = deltaFromSsePayload(payload);
          if (delta) assistantContent += delta;
        }
      } catch (e: any) {
        interrupted = e?.name === 'AbortError';
        if (!interrupted) throw e;
      } finally {
        if (pendingMessageId) finishChatJob(pendingMessageId);
        if (assistantContent.trim()) {
          if (pendingMessageId) {
            updateMessageStatus(pendingMessageId, 'completed', assistantContent.trim());
          } else {
            addMessage(conversation_id, 'assistant', assistantContent.trim(), { model });
          }
        } else if (pendingMessageId) {
          updateMessageStatus(
            pendingMessageId,
            'error',
            '',
            interrupted ? '已中断' : '模型返回为空'
          );
        }
        closeClient();
        if (!interrupted) {
          void maybeAutoSummarize(conversation_id).catch((e) => console.warn('auto-summarize', e));
        }
      }
    })();

    keepAlive(consume);

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controllerRef = controller;
        for (const chunk of queued) {
          try {
            controller.enqueue(chunk);
          } catch {
            controllerRef = null;
            queued.length = 0;
            return;
          }
        }
        queued.length = 0;
        if (finished) {
          try {
            controller.close();
          } catch {}
          controllerRef = null;
        }
      },
      cancel() {
        controllerRef = null;
        queued.length = 0;
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
      finishChatJob(pendingMessageId);
      if (e?.name === 'AbortError') {
        updateMessageStatus(pendingMessageId, 'error', '', '已中断');
      } else {
        updateMessageStatus(pendingMessageId, 'error', '', e.message);
      }
    }
    if (e?.name === 'AbortError') return NextResponse.json({ ok: true, cancelled: true });
    const status = e.status || 500;
    return NextResponse.json({ error: e.message }, { status });
  }
}
