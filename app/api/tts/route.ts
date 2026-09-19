import { NextResponse } from 'next/server';
import { createReadStream, existsSync } from 'fs';
import { Readable } from 'stream';
import { join } from 'path';
import { resolveSpeechBackend } from '@/app/lib/backends';
import { openSpeechStream, ttsHealth } from '@/app/lib/providers/tts';
import { getMessage, mergeMessageExtra } from '@/app/lib/db';
import { audioFileExists, openAudioWrite, removeAudioFile } from '@/app/lib/audio';

const DATA_DIR = process.env.DATA_DIR || './data';

function fileResponse(rel: string, cached: boolean) {
  const abs = join(/* turbopackIgnore: true */ DATA_DIR, rel);
  const nodeStream = createReadStream(/* turbopackIgnore: true */ abs);
  const web = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
  return new Response(web, {
    headers: {
      'Content-Type': 'audio/wav',
      'Cache-Control': cached ? 'public, max-age=31536000, immutable' : 'no-store',
      'X-Audio-Path': rel,
      'X-Audio-Cached': cached ? '1' : '0',
    },
  });
}

export async function GET() {
  const backend = resolveSpeechBackend();
  if (!backend?.baseUrl) {
    return NextResponse.json({ ok: false, error: '未配置朗读供应商' }, { status: 400 });
  }
  const result = await ttsHealth(backend);
  return NextResponse.json({
    ok: result.ok,
    status: result.status,
    body: result.body,
    backend: result.backend,
    voice: backend.voice,
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const text = String(body.text || body.input || '');
  const messageId = typeof body.message_id === 'string' ? body.message_id : '';

  try {
    if (messageId) {
      const msg = getMessage(messageId);
      const rel = msg?.extra_json?.audio_path as string | undefined;
      if (rel && audioFileExists(rel)) {
        return fileResponse(rel, true);
      }
    }

    const { upstream, contentType } = await openSpeechStream({
      text: text || (messageId ? getMessage(messageId)?.content || '' : ''),
      voice: body.voice,
      language: body.language,
      instruct: body.instruct,
      seed: body.seed,
    });
    if (!upstream.body) {
      return NextResponse.json({ error: 'empty upstream' }, { status: 502 });
    }

    const persist = messageId ? openAudioWrite(messageId) : null;
    const reader = upstream.body.getReader();
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            if (persist) {
              await new Promise<void>((resolve, reject) => {
                persist.stream.end((err) => (err ? reject(err) : resolve()));
              });
              mergeMessageExtra(messageId, { audio_path: persist.rel });
            }
            controller.close();
            return;
          }
          if (value) {
            persist?.stream.write(Buffer.from(value));
            controller.enqueue(value);
          }
        } catch (e: any) {
          if (persist) {
            persist.stream.destroy();
            removeAudioFile(persist.abs);
          }
          controller.error(e);
        }
      },
      cancel() {
        reader.cancel().catch(() => {});
        if (persist) {
          persist.stream.destroy();
          removeAudioFile(persist.abs);
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
        ...(persist ? { 'X-Audio-Path': persist.rel, 'X-Audio-Cached': '0' } : {}),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
}
