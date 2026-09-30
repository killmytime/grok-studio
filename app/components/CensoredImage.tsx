'use client';

import { useEffect, useRef, useState, type MouseEvent, type SyntheticEvent } from 'react';
import { UNCENSORED_EVENT, readUncensored, writeUncensored } from '@/app/lib/uncensor';

const BLOCK = 16;

export function useUncensored(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const sync = () => setOn(readUncensored());
    sync();
    window.addEventListener(UNCENSORED_EVENT, sync);
    return () => window.removeEventListener(UNCENSORED_EVENT, sync);
  }, []);
  return on;
}

export function UncensorButton({ className }: { className?: string }) {
  const on = useUncensored();
  return (
    <button
      type="button"
      aria-pressed={on}
      title={on ? '这个会话正在看原图' : '只在这个浏览器会话里看原图'}
      className={className}
      onClick={() => writeUncensored(!on)}
    >
      {on ? '打码' : '原图'}
    </button>
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image failed'));
    img.src = src;
  });
}

function paintMosaic(canvas: HTMLCanvasElement, img: HTMLImageElement, fit: 'contain' | 'cover') {
  const dw = Math.max(1, canvas.clientWidth);
  const dh = Math.max(1, canvas.clientHeight);
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const sw = Math.max(1, Math.round(dw / BLOCK));
  const sh = Math.max(1, Math.round(dh / BLOCK));
  const off = document.createElement('canvas');
  off.width = sw;
  off.height = sh;
  const octx = off.getContext('2d');
  if (!octx) return;
  octx.imageSmoothingEnabled = true;
  const ir = img.naturalWidth / img.naturalHeight;
  const r = dw / dh;
  if (fit === 'cover') {
    let sx = 0;
    let sy = 0;
    let cw = img.naturalWidth;
    let ch = img.naturalHeight;
    if (ir > r) {
      cw = img.naturalHeight * r;
      sx = (img.naturalWidth - cw) / 2;
    } else {
      ch = img.naturalWidth / r;
      sy = (img.naturalHeight - ch) / 2;
    }
    octx.drawImage(img, sx, sy, cw, ch, 0, 0, sw, sh);
  } else {
    let tw = sw;
    let th = sw / ir;
    if (th > sh) {
      th = sh;
      tw = sh * ir;
    }
    octx.drawImage(img, (sw - tw) / 2, (sh - th) / 2, tw, th);
  }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, 0, 0, dw, dh);
}

export async function downloadImage(src: string, filename: string, revealed: boolean) {
  const a = document.createElement('a');
  a.download = filename;
  if (!revealed) {
    const img = await loadImage(src);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const sw = Math.max(1, Math.round(img.naturalWidth / BLOCK));
    const sh = Math.max(1, Math.round(img.naturalHeight / BLOCK));
    const off = document.createElement('canvas');
    off.width = sw;
    off.height = sh;
    off.getContext('2d')?.drawImage(img, 0, 0, sw, sh);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
    }
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    a.href = url;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return;
  }
  a.href = src;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

interface Props {
  src: string;
  alt?: string;
  className?: string;
  fit?: 'contain' | 'cover';
  /** Fill the parent box. Otherwise the canvas keeps the picture's aspect ratio. */
  fill?: boolean;
  draggable?: boolean;
  loading?: 'lazy' | 'eager';
  onClick?: (e: MouseEvent) => void;
  onLoad?: (e: SyntheticEvent<HTMLImageElement>) => void;
}

export default function CensoredImage({
  src,
  alt = '',
  className = '',
  fit = 'contain',
  fill = false,
  draggable = false,
  loading,
  onClick,
  onLoad,
}: Props) {
  const revealed = useUncensored();
  const [node, setNode] = useState<HTMLCanvasElement | null>(null);
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;

  useEffect(() => {
    if (revealed || !node) return;
    let dead = false;
    let ro: ResizeObserver | null = null;
    const img = new Image();
    img.onload = () => {
      if (dead) return;
      if (!fill) node.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
      const paint = () => {
        if (!dead && node.clientWidth > 1 && node.clientHeight > 1) paintMosaic(node, img, fit);
      };
      requestAnimationFrame(paint);
      ro = new ResizeObserver(paint);
      ro.observe(node);
      onLoadRef.current?.({} as SyntheticEvent<HTMLImageElement>);
    };
    img.src = src;
    return () => {
      dead = true;
      ro?.disconnect();
    };
  }, [revealed, node, src, fit, fill]);

  if (revealed) {
    return (
      <img
        src={src}
        alt={alt}
        draggable={draggable}
        loading={loading}
        onClick={onClick}
        onLoad={onLoad}
        className={className}
      />
    );
  }

  return (
    <canvas
      ref={setNode}
      role="img"
      aria-label={alt}
      onClick={onClick}
      className={`${className} bg-zinc-900`}
    />
  );
}
