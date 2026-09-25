import { after, NextResponse } from 'next/server';
import { addMessage, getConversation, getConversationSummary, getImage, getMessage, getSetting, listMessages, mergeMessageExtra, updateMessageStatus } from '@/app/lib/db';
import { assertChatConfigured, chatHeaders, fetchChatCompletions } from '@/app/lib/providers/chat';
import { resolveChatBackend } from '@/app/lib/backends';
import { buildChatContext, usableTurns } from '@/app/lib/chat-context';
import {
  buildResponsesInput,
  imageCallKey,
  imageFileBase64,
  noticesFromResponsesPayload,
  responsesUnsupported,
  saveChatToolImage,
  slimChatImage,
} from '@/app/lib/chat-images';
import { mergeImageMeta } from '@/app/lib/image-meta';
import { maybeAutoSummarize } from '@/app/lib/summarize';
import { cancelChatJob, finishChatJob, hasChatJob, registerChatJob } from '@/app/lib/chat-jobs';
import { createSseParser, deltaFromSsePayload } from '@/app/lib/sse';
import type { ImageAsset } from '@/app/lib/types';

const responsesMisses = new Set<string>();

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
  const summary = getConversationSummary(conversation_id);
  const source = usableTurns(dbMessages).length > 0 ? dbMessages : (Array.isArray(messages) ? messages : []);
  const limited = buildChatContext(source, summary);
  const abort = pendingMessageId ? registerChatJob(pendingMessageId) : new AbortController();
  const temp = isNaN(temperature) ? 0.7 : temperature;
  const maxOut = isNaN(maxTokens) ? 4096 : maxTokens;

  function rehydrateImage(imageId: string): string | null {
    const img = getImage(imageId);
    if (!img?.file_path) return null;
    return imageFileBase64(img.file_path);
  }

  try {
    let upstream: Response | null = null;
    let mode: 'responses' | 'completions' = 'completions';

    if (backend.provider === 'grok') {
      const responsesRes = await fetch(`${backend.baseUrl.replace(/\/+$/, '')}/responses`, {
        method: 'POST',
        headers: chatHeaders(backend),
        body: JSON.stringify({
          model,
          input: buildResponsesInput(source, summary, rehydrateImage),
          tools: [{ type: 'image_generation' }],
          stream: true,
          store: false,
          temperature: temp,
          max_output_tokens: maxOut,
        }),
        signal: abort.signal,
      });
      if (responsesRes.ok && responsesRes.body) {
        upstream = responsesRes;
        mode = 'responses';
      } else if (responsesUnsupported(responsesRes.status)) {
        await responsesRes.arrayBuffer().catch(() => undefined);
        if (!responsesMisses.has(backend.baseUrl)) {
          responsesMisses.add(backend.baseUrl);
          console.warn(`Grok /responses 不可用，聊天退回纯文本：${backend.baseUrl}`);
        }
      } else {
        const errText = await responsesRes.text();
        if (pendingMessageId) {
          updateMessageStatus(pendingMessageId, 'error', '', `上游错误: ${responsesRes.status}`);
          finishChatJob(pendingMessageId);
        }
        return NextResponse.json({ error: 'Upstream error', status: responsesRes.status, body: errText }, { status: 502 });
      }
    }

    if (!upstream) {
      upstream = await fetchChatCompletions(
        {
          model,
          messages: limited,
          stream: true,
          temperature: temp,
          max_tokens: maxOut,
        },
        backend,
        { signal: abort.signal }
      );
      mode = 'completions';
    }

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
      let streamError = '';
      let responseId: string | null = null;
      const seenCalls = new Set<string>();
      const saved: Array<{ asset: ImageAsset; call: Record<string, unknown> }> = [];

      function sse(obj: unknown) {
        pushToClient(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      }

      async function takePayload(payload: string) {
        if (mode === 'completions') {
          const delta = deltaFromSsePayload(payload);
          if (delta) assistantContent += delta;
          return;
        }
        for (const notice of noticesFromResponsesPayload(payload)) {
          if (notice.type === 'text') {
            assistantContent += notice.delta;
            sse({ choices: [{ delta: { content: notice.delta } }] });
          } else if (notice.type === 'status') {
            sse({ studio_status: notice.status });
          } else if (notice.type === 'response_id') {
            responseId = notice.id;
          } else if (notice.type === 'error') {
            streamError = notice.message;
          } else if (notice.type === 'image') {
            const key = imageCallKey(notice.item);
            if (seenCalls.has(key)) continue;
            try {
              const savedOne = await saveChatToolImage({
                item: notice.item,
                conversationId: conversation_id,
                messageId: pendingMessageId,
                chatModel: model,
                responseId,
                nIndex: saved.length + 1,
              });
              if (!savedOne) continue;
              seenCalls.add(key);
              saved.push(savedOne);
              sse({ studio_image: slimChatImage(savedOne.asset) });
            } catch (e: any) {
              console.error('chat image save', e);
              streamError = streamError || e?.message || '图片没存下来';
            }
          }
        }
      }

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          if (mode === 'completions') pushToClient(encoder.encode(chunk));
          for (const payload of parser.take(chunk)) await takePayload(payload);
        }
        for (const payload of parser.flush()) await takePayload(payload);
        if (mode === 'responses') sse({ choices: [{ delta: {} }] });
      } catch (e: any) {
        interrupted = e?.name === 'AbortError';
        if (!interrupted) throw e;
      } finally {
        if (pendingMessageId) finishChatJob(pendingMessageId);
        const text = assistantContent.trim();
        if (responseId) {
          for (const item of saved) mergeImageMeta(item.asset.id, { response_id: responseId });
        }
        if (text || saved.length) {
          const extra = saved.length
            ? {
                model,
                response_id: responseId,
                image_calls: saved.map((item) => item.call),
                images: saved.map((item) => slimChatImage(item.asset)),
              }
            : undefined;
          if (pendingMessageId) {
            updateMessageStatus(pendingMessageId, 'completed', text);
            if (extra) mergeMessageExtra(pendingMessageId, extra);
          } else {
            addMessage(conversation_id, 'assistant', text, extra || { model });
          }
        } else if (pendingMessageId) {
          updateMessageStatus(
            pendingMessageId,
            'error',
            '',
            interrupted ? '已中断' : (streamError || '模型返回为空')
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
