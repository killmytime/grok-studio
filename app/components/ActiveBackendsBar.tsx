'use client';

import { describeFromSettings, type ActiveBackends, type SettingsLike } from '@/app/lib/integrations/catalog';

function Chip({ kind, model, label, warn }: { kind: string; model: string; label: string; warn?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 max-w-[220px] truncate"
      title={warn || `${kind} · ${model} · ${label}`}
    >
      <span className="text-zinc-600">{kind}</span>
      <span className="text-zinc-200 truncate">{model || '—'}</span>
      <span className="text-zinc-500 truncate">· {label}</span>
      {warn ? <span className="text-amber-500">!</span> : null}
    </span>
  );
}

export default function ActiveBackendsBar({ settings }: { settings: SettingsLike }) {
  const active: ActiveBackends = settings.active || describeFromSettings(settings);
  const genWarn = !active.generate.supportsEdit
    ? `生图后端 ${active.generate.label} 不支持编辑；改图走 ${active.edit.label}`
    : undefined;

  return (
    <div
      data-testid="active-backends"
      className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] leading-tight text-zinc-400 min-w-0"
    >
      <Chip kind="聊天" model={active.chat.model} label={active.chat.label} />
      <Chip kind="生图" model={active.generate.model} label={active.generate.label} warn={genWarn} />
      <Chip
        kind="改图"
        model={active.edit.available ? active.edit.model : '不可用'}
        label={active.edit.available ? active.edit.label : (active.edit.reason || '不支持')}
      />
    </div>
  );
}
