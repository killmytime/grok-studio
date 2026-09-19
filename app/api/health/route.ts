import { NextResponse } from 'next/server';
import { resolveChatBackend, resolveImageGenerateBackend, resolveSpeechBackend, bearerHeaders } from '@/app/lib/backends';
import { assertChatConfigured, fetchChatCompletions } from '@/app/lib/providers/chat';
import { jetsonHealth } from '@/app/lib/providers/jetson';
import { ttsHealth } from '@/app/lib/providers/tts';
import { canonicalIntegrationId } from '@/app/lib/integrations/catalog';

export async function POST(req: Request) {
  const { type } = await req.json(); // 'chat' | 'image' | 'generate' | 'jetson' | 'imagen' | 'tts'

  try {
    if (type === 'tts' || type === 'speech') {
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
      });
    }

    if (type === 'chat') {
      const backend = resolveChatBackend();
      const configured = assertChatConfigured(backend);
      if (configured) {
        return NextResponse.json({ ok: false, error: configured }, { status: 400 });
      }
      const res = await fetchChatCompletions({
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 5,
        stream: false,
      }, backend);
      const data = await res.json().catch(() => ({}));
      return NextResponse.json({ ok: res.ok, status: res.status, body: data, backend: backend.baseUrl });
    }

    const backend = resolveImageGenerateBackend();
    const genId = canonicalIntegrationId(backend.provider);
    const probeImagen = type === 'jetson' || type === 'imagen' || genId === 'imagen';

    if (probeImagen) {
      if (!backend.jetsonGatewayUrl) {
        return NextResponse.json({ ok: false, error: 'Imagen URL not set' }, { status: 400 });
      }
      const result = await jetsonHealth(backend.jetsonGatewayUrl, backend.jetsonApiKey);
      return NextResponse.json({
        ok: result.ok,
        status: result.status,
        body: result.body,
        backend: backend.jetsonGatewayUrl,
      });
    }

    if (!backend.baseUrl || !backend.apiKey) {
      return NextResponse.json({ ok: false, error: 'Image generate backend not configured' }, { status: 400 });
    }
    const res = await fetch(`${backend.baseUrl}/images/generations`, {
      method: 'POST',
      headers: bearerHeaders(backend.apiKey),
      body: JSON.stringify({
        model: backend.model,
        prompt: 'test',
        n: 1,
        aspect_ratio: '1:1',
        resolution: '1k',
      }),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json({ ok: res.ok, status: res.status, body: data, backend: backend.baseUrl });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
