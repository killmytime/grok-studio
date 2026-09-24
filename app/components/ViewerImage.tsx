'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  thumbSrc?: string | null;
  fullSrc: string;
  alt: string;
  rotation?: number;
  imgClassName?: string;
  onClick?: () => void;
}

export default function ViewerImage({
  thumbSrc,
  fullSrc,
  alt,
  rotation = 0,
  imgClassName = '',
  onClick,
}: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [fullReady, setFullReady] = useState(false);

  useEffect(() => {
    setFullReady(false);
  }, [fullSrc]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const sync = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    sync();
    return () => ro.disconnect();
  }, []);

  const quarter = Math.abs(rotation % 180) === 90;
  const w = quarter ? box.h : box.w;
  const h = quarter ? box.w : box.h;
  const showThumb = Boolean(thumbSrc) && !fullReady;

  return (
    <div ref={boxRef} className="relative h-full w-full overflow-hidden">
      <div
        className="absolute left-1/2 top-1/2 will-change-transform"
        data-rotation={rotation}
        style={{
          width: w || '100%',
          height: h || '100%',
          transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
          transition: 'transform 220ms ease',
        }}
      >
        {showThumb && (
          <img
            src={thumbSrc!}
            alt=""
            draggable={false}
            className={`absolute inset-0 h-full w-full object-contain ${imgClassName}`}
          />
        )}
        <img
          src={fullSrc}
          alt={alt}
          draggable={false}
          onClick={onClick}
          onLoad={() => setFullReady(true)}
          className={`h-full w-full object-contain transition-opacity duration-300 ${
            fullReady || !thumbSrc ? 'opacity-100' : 'opacity-0'
          } ${imgClassName}`}
        />
      </div>
    </div>
  );
}
