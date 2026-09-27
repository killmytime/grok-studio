'use client';

import { comfyStrengthHint } from '@/app/lib/providers/comfy/workflow';

export function ComfyStrength({
  value,
  onChange,
  disabled,
  className,
}: {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  className?: string;
}) {
  const hint = comfyStrengthHint(value);
  return (
    <label className={`flex min-w-0 items-center gap-2 text-[10px] text-zinc-500 ${className || ''}`} title={hint}>
      <span className="shrink-0 tabular-nums">强度 {value.toFixed(2)}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        disabled={disabled}
        aria-label="改图强度"
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 min-w-0 flex-1 accent-zinc-200"
      />
      <span className="max-w-[11rem] shrink-0 truncate">{hint}</span>
    </label>
  );
}
