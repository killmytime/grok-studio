import { readFileSync, existsSync } from 'fs';
import { File } from 'node:buffer';
import { bearerHeaders, resolveSpeechBackend, ttsServiceRoot, type SpeechBackend } from '../backends';
import { speakerPtAbs } from '../audio';

export async function ttsHealth(backend: SpeechBackend) {
  const root = ttsServiceRoot(backend.baseUrl);
  const res = await fetch(`${root}/health`, { headers: bearerHeaders(backend.apiKey) });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok && body.ready === true, status: res.status, body, backend: root };
}

export async function ttsVoices(backend: SpeechBackend) {
  const root = ttsServiceRoot(backend.baseUrl);
  const res = await fetch(`${root}/v1/audio/voices`, { headers: bearerHeaders(backend.apiKey) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.detail || body.error || `voices failed: ${res.status}`) as Error & { status: number };
    err.status = res.status >= 400 ? res.status : 502;
    throw err;
  }
  const voices: string[] = Array.isArray(body.voices) ? body.voices : [];
  return { voices, default_voice: body.default_voice || voices[0] || 'vivian', mode: body.mode, raw: body };
}

export function stripForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]+`/g, ' ')
    .replace(/[#*_>~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function openSpeechStream(opts: {
  text: string;
  voice?: string;
  language?: string;
  instruct?: string;
  seed?: number | string;
  speakerPt?: string;
  backend?: SpeechBackend;
}): Promise<{ upstream: Response; contentType: string }> {
  const backend = opts.backend || resolveSpeechBackend();
  if (!backend?.baseUrl) {
    const err = new Error('未配置朗读供应商') as Error & { status: number };
    err.status = 400;
    throw err;
  }
  const input = stripForSpeech(opts.text);
  if (!input) {
    const err = new Error('朗读文本为空') as Error & { status: number };
    err.status = 400;
    throw err;
  }

  const health = await ttsHealth(backend);
  if (!health.ok) {
    const err = new Error(health.body?.detail || 'TTS 服务未就绪（/health ready=false）') as Error & { status: number };
    err.status = 503;
    throw err;
  }

  const root = ttsServiceRoot(backend.baseUrl);
  const mode = String(health.body?.mode || '');
  const voices: string[] = Array.isArray(health.body?.voices) ? health.body.voices : [];
  const defaultVoice = String(health.body?.default_voice || '');
  let voice = String(opts.voice || backend.voice || '');
  const speakerPt = opts.speakerPt || backend.speakerPt;
  const language = opts.language || backend.language;
  const instruct = opts.instruct || backend.instruct;
  const seed = opts.seed ?? backend.seed;

  const ptAbs = speakerPt && existsSync(/* turbopackIgnore: true */ speakerPtAbs(speakerPt))
    ? speakerPtAbs(speakerPt)
    : '';

  if (mode === 'clone' && !ptAbs && (!voice || voice === 'dynamic')) {
    const err = new Error('当前 TTS 是 clone 模式，没有 vivian 这类固定音色。请在设置里上传一段参考音频生成音色，再把「朗读」绑到它。') as Error & { status: number };
    err.status = 400;
    throw err;
  }

  if (voices.length && voice && !voices.map((v) => v.toLowerCase()).includes(voice.toLowerCase()) && !ptAbs) {
    voice = defaultVoice || voices[0];
  }
  if (!voice) voice = defaultVoice || (mode === 'clone' ? 'dynamic' : voices[0] || '');

  const auth: Record<string, string> = { Accept: 'audio/wav' };
  if (backend.apiKey) auth.Authorization = `Bearer ${backend.apiKey}`;

  let res: Response;
  if (ptAbs) {
    const form = new FormData();
    form.set('model', 'tts-1');
    form.set('input', input);
    form.set('voice', 'dynamic');
    form.set('response_format', 'wav');
    if (language) form.set('language', language);
    if (instruct) form.set('instruct', instruct);
    if (seed !== '' && seed != null) {
      const n = Number(seed);
      if (!Number.isNaN(n)) form.set('seed', String(n));
    }
    const ptBuf = readFileSync(/* turbopackIgnore: true */ ptAbs);
    form.set('voice_clone_pt', new File([ptBuf], 'speaker.pt', { type: 'application/octet-stream' }));
    res = await fetch(`${root}/v1/audio/speech`, { method: 'POST', headers: auth, body: form });
  } else {
    const body: Record<string, unknown> = {
      model: 'tts-1',
      input,
      voice,
      response_format: 'wav',
    };
    if (language) body.language = language;
    if (instruct) body.instruct = instruct;
    if (seed !== '' && seed != null) {
      const n = Number(seed);
      if (!Number.isNaN(n)) body.seed = n;
    }
    res = await fetch(`${root}/v1/audio/speech`, {
      method: 'POST',
      headers: { ...bearerHeaders(backend.apiKey), Accept: 'audio/wav' },
      body: JSON.stringify(body),
    });
  }

  if (!res.ok || !res.body) {
    const errBody = await res.json().catch(() => ({}));
    const err = new Error(errBody.detail || errBody.error || `TTS 失败: ${res.status}`) as Error & { status: number };
    err.status = res.status >= 400 ? res.status : 502;
    throw err;
  }
  return { upstream: res, contentType: res.headers.get('content-type') || 'audio/wav' };
}

export async function cloneSpeakerPt(opts: {
  backend: SpeechBackend;
  refAudio: Buffer;
  filename?: string;
}): Promise<Buffer> {
  const root = ttsServiceRoot(opts.backend.baseUrl);
  const form = new FormData();
  form.set('ref_audio', new File([opts.refAudio], 'ref_audio.wav', { type: 'audio/wav' }));
  form.set('filename', opts.filename || 'speaker.pt');
  const headers: Record<string, string> = {};
  if (opts.backend.apiKey) headers.Authorization = `Bearer ${opts.backend.apiKey}`;
  const res = await fetch(`${root}/v1/audio/voice-clone/pt`, { method: 'POST', headers, body: form });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const err = new Error(errBody.detail || errBody.error || `克隆失败: ${res.status}`) as Error & { status: number };
    err.status = res.status >= 400 ? res.status : 502;
    throw err;
  }
  return Buffer.from(await res.arrayBuffer());
}

export async function synthesizeSpeech(opts: {
  text: string;
  voice?: string;
  language?: string;
  instruct?: string;
  seed?: number | string;
  backend?: SpeechBackend;
}): Promise<{ buffer: Buffer; contentType: string }> {
  const { upstream, contentType } = await openSpeechStream(opts);
  const buffer = Buffer.from(await upstream.arrayBuffer());
  return { buffer, contentType };
}
