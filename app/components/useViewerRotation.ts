'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type Turn = 0 | 90 | 180 | 270;

function asTurn(n: number): Turn {
  const r = ((n % 360) + 360) % 360;
  if (r === 90 || r === 180 || r === 270) return r;
  return 0;
}

function cssIsLandscape() {
  return window.matchMedia('(orientation: landscape)').matches;
}

function pickAuto(gamma: number, prev: Turn): Turn {
  if (cssIsLandscape()) return 0;
  if (gamma < -55 || (prev === 90 && gamma < -35)) return 90;
  if (gamma > 55 || (prev === 270 && gamma > 35)) return 270;
  if (Math.abs(gamma) < 35) return 0;
  return prev;
}

/**
 * Manual 90° steps, plus physical-tilt auto-rotate when the OS auto-rotate is off.
 * Viewport already landscape → leave the image alone so we don't double-rotate.
 */
export function useViewerRotation(active: boolean, imageKey?: string | null) {
  const [manual, setManual] = useState<Turn>(0);
  const [auto, setAuto] = useState<Turn>(0);
  const autoRef = useRef<Turn>(0);
  const listening = useRef(false);

  autoRef.current = auto;

  useEffect(() => {
    setManual(0);
  }, [imageKey]);

  useEffect(() => {
    if (!active) {
      setManual(0);
      setAuto(0);
      autoRef.current = 0;
    }
  }, [active]);

  const onOrient = useCallback((e: DeviceOrientationEvent) => {
    if (e.gamma == null) return;
    const next = pickAuto(e.gamma, autoRef.current);
    if (next === autoRef.current) return;
    autoRef.current = next;
    setAuto(next);
  }, []);

  const startListening = useCallback(() => {
    if (listening.current || typeof window === 'undefined') return;
    listening.current = true;
    window.addEventListener('deviceorientation', onOrient, true);
  }, [onOrient]);

  const enableDevice = useCallback(async () => {
    const DOE = DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<string>;
    };
    if (typeof DOE.requestPermission === 'function') {
      try {
        const state = await DOE.requestPermission();
        if (state !== 'granted') return false;
      } catch {
        return false;
      }
    }
    startListening();
    return true;
  }, [startListening]);

  useEffect(() => {
    if (!active) return;
    const DOE = DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<string>;
    };
    if (typeof DOE.requestPermission !== 'function') {
      startListening();
    }
    return () => {
      listening.current = false;
      window.removeEventListener('deviceorientation', onOrient, true);
    };
  }, [active, onOrient, startListening]);

  const cycle = useCallback(() => {
    setManual((m) => asTurn(m + 90));
    void enableDevice();
  }, [enableDevice]);

  return {
    // Once the user taps rotate, manual wins. Auto only fills in at 0°
    // so a bogus deviceorientation event cannot cancel a 90° tap.
    rotation: manual === 0 ? auto : manual,
    cycle,
    auto,
    manual,
  };
}
