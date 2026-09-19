/** Browser-only audio playback. Streams PCM16 WAV when possible; otherwise plays a blob. */

export type WavFormat = {
  audioFormat: number;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  blockAlign: number;
  dataOffset: number;
};

export function parseWavHeader(bytes: Uint8Array): WavFormat | null {
  if (bytes.length < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (i: number, n: number) => String.fromCharCode(...bytes.subarray(i, i + n));
  if (tag(0, 4) !== 'RIFF' || tag(8, 4) !== 'WAVE') return null;

  let offset = 12;
  let audioFormat = 1;
  let channels = 1;
  let sampleRate = 24000;
  let bitsPerSample = 16;
  let blockAlign = 2;
  let dataOffset = -1;

  while (offset + 8 <= bytes.length) {
    const id = tag(offset, 4);
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (id === 'fmt ' && start + 16 <= bytes.length) {
      audioFormat = view.getUint16(start, true);
      channels = view.getUint16(start + 2, true) || 1;
      sampleRate = view.getUint32(start + 4, true) || sampleRate;
      blockAlign = view.getUint16(start + 12, true) || channels * 2;
      bitsPerSample = view.getUint16(start + 14, true) || 16;
    }
    if (id === 'data') {
      dataOffset = start;
      break;
    }
    const next = start + size + (size % 2);
    if (next <= offset) break;
    offset = next;
  }
  if (dataOffset < 0 || dataOffset > bytes.length) return null;
  return { audioFormat, channels, sampleRate, bitsPerSample, blockAlign, dataOffset };
}

function canStreamPcm16(format: WavFormat) {
  return format.audioFormat === 1 && format.bitsPerSample === 16 && format.channels >= 1;
}

function pcm16ToAudioBuffer(ctx: AudioContext, pcm: Uint8Array, format: WavFormat): AudioBuffer {
  const channels = format.channels || 1;
  const frameBytes = format.blockAlign || channels * 2;
  const frames = Math.floor(pcm.length / frameBytes);
  const buffer = ctx.createBuffer(channels, Math.max(frames, 1), format.sampleRate);
  const view = new DataView(pcm.buffer, pcm.byteOffset, frames * frameBytes);
  for (let ch = 0; ch < channels; ch++) {
    const out = buffer.getChannelData(ch);
    for (let i = 0; i < frames; i++) {
      out[i] = view.getInt16(i * frameBytes + ch * 2, true) / 32768;
    }
  }
  return buffer;
}

function playHtmlAudio(blob: Blob, signal?: AbortSignal): Promise<void> {
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.preload = 'auto';
  return new Promise((resolve, reject) => {
    const done = () => {
      URL.revokeObjectURL(url);
      resolve();
    };
    audio.onended = done;
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('浏览器无法播放该音频'));
    };
    const onAbort = () => {
      audio.pause();
      done();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    audio.play().catch((e) => {
      URL.revokeObjectURL(url);
      reject(e);
    });
  });
}

export async function playAudioResponse(
  res: Response,
  opts?: { signal?: AbortSignal; ctx?: AudioContext }
): Promise<void> {
  if (!res.body) throw new Error('empty audio stream');
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  const ctx = opts?.ctx || new AudioContext();
  let format: WavFormat | null = null;
  let pending = new Uint8Array(0);
  let nextTime = 0;
  let playedFrames = 0;
  const sources: AudioBufferSourceNode[] = [];
  let live = true;

  const stopLive = () => {
    live = false;
    sources.forEach((s) => {
      try { s.stop(); } catch {}
    });
  };

  const onAbort = () => {
    reader.cancel().catch(() => {});
    stopLive();
    ctx.close().catch(() => {});
  };
  opts?.signal?.addEventListener('abort', onAbort, { once: true });

  const enqueue = (pcm: Uint8Array) => {
    if (!format || !canStreamPcm16(format) || pcm.length < format.blockAlign) return 0;
    const usable = pcm.length - (pcm.length % format.blockAlign);
    if (usable < format.blockAlign) return 0;
    const slice = pcm.subarray(0, usable);
    const audioBuf = pcm16ToAudioBuffer(ctx, slice, format);
    const src = ctx.createBufferSource();
    src.buffer = audioBuf;
    src.connect(ctx.destination);
    if (nextTime < ctx.currentTime) nextTime = ctx.currentTime + 0.03;
    src.start(nextTime);
    nextTime += audioBuf.duration;
    sources.push(src);
    playedFrames += audioBuf.length;
    return usable;
  };

  try {
    if (ctx.state === 'suspended') await ctx.resume();

    while (!opts?.signal?.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.length) continue;
      chunks.push(value);
      if (!live) continue;

      const merged = new Uint8Array(pending.length + value.length);
      merged.set(pending);
      merged.set(value, pending.length);
      pending = merged;

      if (!format) {
        format = parseWavHeader(pending);
        if (!format) continue;
        if (!canStreamPcm16(format)) {
          live = false;
          continue;
        }
        pending = pending.subarray(format.dataOffset);
      }
      const used = enqueue(pending);
      pending = pending.subarray(used);
    }

    if (live && format && canStreamPcm16(format) && pending.length >= format.blockAlign) {
      enqueue(pending);
    }

    if (playedFrames > 0 && !opts?.signal?.aborted) {
      const remaining = Math.max(0, nextTime - ctx.currentTime);
      if (remaining > 0) await new Promise((r) => setTimeout(r, remaining * 1000 + 60));
      return;
    }

    if (opts?.signal?.aborted) return;
    const blob = new Blob(chunks as BlobPart[], { type: res.headers.get('content-type') || 'audio/wav' });
    if (blob.size < 16) throw new Error('音频为空');
    await playHtmlAudio(blob, opts?.signal);
  } finally {
    opts?.signal?.removeEventListener('abort', onAbort);
    stopLive();
    ctx.close().catch(() => {});
  }
}

export { playHtmlAudio };
