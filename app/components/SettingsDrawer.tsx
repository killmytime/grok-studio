'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Settings } from 'lucide-react';
import { getIntegration, integrationsFor, type Capability, type IntegrationManifest } from '@/app/lib/integrations/catalog';
import type { AppSettings } from '@/app/lib/types';

const CAP_LABEL: Record<Capability, string> = {
  chat: '聊天',
  'image.generate': '生图',
  'image.edit': '改图',
  speech: '朗读',
};

type VendorModel = { model: string; capabilities: Capability[]; extra?: Record<string, unknown> | null };
type RemoteModel = { id: string; suggested: Capability[] };
type Vendor = {
  id: string;
  kind: string;
  label: string;
  base_url: string;
  api_key: string;
  extra: Record<string, unknown>;
  models: VendorModel[];
};
type Binding = { capability: Capability; vendor_id: string; model: string };

interface Props {
  settings: AppSettings;
  onSave: (s: Partial<AppSettings>) => Promise<void>;
  onTest: (type: 'chat' | 'image' | 'jetson' | 'tts') => Promise<any>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label className="text-xs text-zinc-400">{label}</label>
      {children}
      {hint ? <div className="text-[10px] text-zinc-600 mt-1">{hint}</div> : null}
    </div>
  );
}

export default function SettingsDrawer({ settings, onSave, onTest }: Props) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(settings);
  const [vendors, setVendors] = useState<Vendor[]>((settings as any).vendors || []);
  const [bindings, setBindings] = useState<Binding[]>((settings as any).bindings || []);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<any>(null);
  const [addKind, setAddKind] = useState('ollama');
  const [remote, setRemote] = useState<Record<string, RemoteModel[]>>({});
  const [fetching, setFetching] = useState<Record<string, boolean>>({});
  const [fetchErr, setFetchErr] = useState<Record<string, string>>({});
  const [ttsPreviewUrl, setTtsPreviewUrl] = useState<string | null>(null);
  const [ttsPreviewing, setTtsPreviewing] = useState(false);
  const [ttsMeta, setTtsMeta] = useState<Record<string, { mode?: string; default_voice?: string }>>({});
  const [cloneName, setCloneName] = useState<Record<string, string>>({});
  const [cloning, setCloning] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setForm(settings);
    setVendors((settings as any).vendors || []);
    setBindings((settings as any).bindings || []);
  }, [settings]);

  const set = (key: keyof AppSettings, value: string) => setForm({ ...form, [key]: value });

  async function refresh() {
    const res = await fetch('/api/settings');
    const data = await res.json();
    setVendors(data.vendors || []);
    setBindings(data.bindings || []);
    setForm((prev) => ({ ...prev, ...data }));
  }

  const handleSave = async () => {
    await onSave({
      temperature: form.temperature,
      max_tokens: form.max_tokens,
      default_aspect_ratio: form.default_aspect_ratio,
      default_resolution: form.default_resolution,
      default_n: form.default_n,
      edit_compatibility_mode: form.edit_compatibility_mode,
    });
    await refresh();
    setOpen(false);
  };

  const test = async (type: 'chat' | 'image' | 'jetson' | 'tts') => {
    setTesting(type);
    setTestResult(null);
    const res = await onTest(type);
    setTestResult(res);
    setTesting(null);
  };

  async function saveVendor(v: Vendor) {
    await fetch('/api/vendors', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(v),
    });
    await refresh();
  }

  async function addVendor() {
    await fetch('/api/vendors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: addKind }),
    });
    await refresh();
  }

  async function removeVendor(id: string) {
    await fetch('/api/vendors', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    await refresh();
  }

  async function fetchModels(v: Vendor) {
    setFetching((p) => ({ ...p, [v.id]: true }));
    setFetchErr((p) => ({ ...p, [v.id]: '' }));
    try {
      const res = await fetch('/api/vendors/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendor_id: v.id,
          kind: v.kind,
          base_url: v.base_url,
          api_key: v.api_key,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '拉取失败');
      const list: RemoteModel[] = data.models || [];
      setRemote((p) => ({ ...p, [v.id]: list }));
      if (data.mode || data.default_voice) {
        setTtsMeta((p) => ({ ...p, [v.id]: { mode: data.mode, default_voice: data.default_voice } }));
      }
    } catch (e: any) {
      setFetchErr((p) => ({ ...p, [v.id]: e.message || '拉取失败' }));
    } finally {
      setFetching((p) => ({ ...p, [v.id]: false }));
    }
  }

  function patchVendor(id: string, patch: Partial<Vendor>) {
    setVendors((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

  function addRemoteModel(v: Vendor, modelId: string) {
    if (!modelId || v.models.some((m) => m.model === modelId)) return;
    const suggested = remote[v.id]?.find((m) => m.id === modelId)?.suggested
      || getIntegration(v.kind).capabilities.slice(0, 1);
    patchVendor(v.id, { models: [...v.models, { model: modelId, capabilities: suggested }] });
  }

  function toggleCap(v: Vendor, model: string, cap: Capability) {
    const allowed = getIntegration(v.kind).capabilities;
    if (!allowed.includes(cap)) return;
    patchVendor(v.id, {
      models: v.models.map((m) => {
        if (m.model !== model) return m;
        const has = m.capabilities.includes(cap);
        return {
          ...m,
          capabilities: has ? m.capabilities.filter((c) => c !== cap) : [...m.capabilities, cap],
        };
      }),
    });
  }

  function removeModel(v: Vendor, model: string) {
    patchVendor(v.id, { models: v.models.filter((m) => m.model !== model) });
  }

  async function bind(capability: Capability, vendor_id: string, model: string) {
    await fetch('/api/bindings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capability, vendor_id, model }),
    });
    await refresh();
  }

  function bindingFor(cap: Capability): Binding | undefined {
    return bindings.find((b) => b.capability === cap);
  }

  function modelsFor(cap: Capability) {
    return vendors.flatMap((v) =>
      v.models
        .filter((m) => m.capabilities.includes(cap))
        .map((m) => ({ vendor: v, model: m.model }))
    );
  }

  const genVendor = vendors.find((v) => v.id === bindingFor('image.generate')?.vendor_id);
  const genKind = genVendor ? getIntegration(genVendor.kind).id : (form.image_generate_provider || 'grok');

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setOpen(true)}>
        <Settings className="w-4 h-4" />
      </Button>
      <DialogContent className="sm:max-w-[680px] bg-zinc-950 border-zinc-800 max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-2">
          <section className="space-y-2">
            <div className="text-xs font-medium text-zinc-300">访问</div>
            <div className="text-[10px] text-zinc-500">
              {(settings as any).auth_required
                ? '已启用访问密码（STUDIO_PASSWORD）。IPv4 / IPv6 / 局域网同一道门，不在界面改密码。'
                : '未设置 STUDIO_PASSWORD：本机/局域网均可直接打开。需要统一鉴权时在环境变量里加一行即可。'}
            </div>
            {(settings as any).auth_required && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={async () => {
                  await fetch('/api/auth/logout', { method: 'POST' });
                  window.location.href = '/login';
                }}
              >
                退出登录
              </Button>
            )}
          </section>

          <section className="space-y-3">
            <div className="text-xs font-medium text-zinc-300">供应商</div>
            <div className="text-[10px] text-zinc-500">
              数组结构，存在 SQLite。Grok 是基本盘；Ollama / Imagen 在这里添加，不必再堆环境变量。
            </div>
            {vendors.map((v) => {
              const kind = getIntegration(v.kind);
              return (
                <div key={v.id} className="rounded-lg border border-zinc-800 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs text-zinc-200">{v.label} <span className="text-zinc-500">· {kind.id}</span></div>
                    {v.id !== 'grok' && (
                      <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => removeVendor(v.id)}>删除</Button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="名称">
                      <Input className="settings-input mt-1" value={v.label} onChange={(e) => setVendors((prev) => prev.map((x) => x.id === v.id ? { ...x, label: e.target.value } : x))} />
                    </Field>
                    <Field label="URL">
                      <Input className="settings-input mt-1" value={v.base_url} onChange={(e) => setVendors((prev) => prev.map((x) => x.id === v.id ? { ...x, base_url: e.target.value } : x))} />
                    </Field>
                    <Field label="API Key">
                      <Input className="settings-input mt-1" type="password" value={v.api_key} onChange={(e) => setVendors((prev) => prev.map((x) => x.id === v.id ? { ...x, api_key: e.target.value } : x))} />
                    </Field>
                    {(kind.extraFields || []).filter((f) => f.kind !== 'url' && f.kind !== 'password').map((field) => (
                      <Field key={field.key} label={field.label} hint={field.hint}>
                        <Input
                          className="settings-input mt-1"
                          placeholder={field.placeholder}
                          value={String(v.extra?.[field.key] ?? '')}
                          onChange={(e) => patchVendor(v.id, { extra: { ...(v.extra || {}), [field.key]: e.target.value } })}
                        />
                      </Field>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2 items-center">
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => fetchModels(v)} disabled={!!fetching[v.id] || !v.base_url}>
                      {fetching[v.id] ? '拉取中…' : (kind.id === 'qwen3tts' ? '从 /v1/audio/voices 拉取' : '从 /v1/models 拉取')}
                    </Button>
                    <select
                      className="settings-input h-7 rounded-md bg-transparent border px-2 text-xs min-w-[160px]"
                      defaultValue=""
                      onChange={(e) => {
                        addRemoteModel(v, e.target.value);
                        e.target.value = '';
                      }}
                    >
                      <option value="">{(remote[v.id] || []).length ? (kind.id === 'qwen3tts' ? '选择音色加入' : '选择模型加入') : (kind.id === 'qwen3tts' ? '先拉取音色列表' : '先拉取模型列表')}</option>
                      {(remote[v.id] || []).filter((m) => !v.models.some((s) => s.model === m.id)).map((m) => (
                        <option key={m.id} value={m.id}>{m.id}</option>
                      ))}
                    </select>
                  </div>
                  {fetchErr[v.id] ? <div className="text-[10px] text-red-400">{fetchErr[v.id]}</div> : null}
                  {kind.id === 'qwen3tts' && ttsMeta[v.id]?.mode === 'clone' && (
                    <div className="text-[10px] text-amber-400">
                      这是 clone 镜像，没有 vivian。只有 dynamic。请上传 3–10 秒参考音频生成音色，再把「朗读」绑到它。
                    </div>
                  )}
                  {kind.id === 'qwen3tts' && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        className="settings-input h-7 text-xs w-28"
                        placeholder="音色名"
                        value={cloneName[v.id] || ''}
                        onChange={(e) => setCloneName((p) => ({ ...p, [v.id]: e.target.value }))}
                      />
                      <label className="text-[11px] text-zinc-400">
                        <input
                          type="file"
                          accept="audio/*,.wav,.mp3,.m4a"
                          className="text-[11px]"
                          disabled={!!cloning[v.id]}
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            e.target.value = '';
                            if (!file) return;
                            const name = (cloneName[v.id] || file.name.replace(/\.[^.]+$/, '') || 'speaker').trim();
                            setCloning((p) => ({ ...p, [v.id]: true }));
                            try {
                              const fd = new FormData();
                              fd.set('vendor_id', v.id);
                              fd.set('name', name);
                              fd.set('ref_audio', file);
                              const res = await fetch('/api/tts/clone', { method: 'POST', body: fd });
                              const data = await res.json();
                              if (!res.ok) throw new Error(data.error || '克隆失败');
                              await refresh();
                            } catch (err: any) {
                              setFetchErr((p) => ({ ...p, [v.id]: err.message }));
                            } finally {
                              setCloning((p) => ({ ...p, [v.id]: false }));
                            }
                          }}
                        />
                        {cloning[v.id] ? '克隆中…' : '上传参考音频克隆'}
                      </label>
                    </div>
                  )}
                  <div className="space-y-1">
                    {v.models.length === 0 && (
                      <div className="text-[10px] text-zinc-500">还没有选用模型。拉取后从下拉列表勾选。</div>
                    )}
                    {v.models.map((m) => (
                      <div key={m.model} className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-300">
                        <span className="font-mono truncate max-w-[200px]" title={m.model}>
                          {m.model}{m.extra?.speaker_pt ? ' · pt' : ''}
                        </span>
                        {kind.capabilities.map((cap) => (
                          <label key={cap} className="inline-flex items-center gap-1 text-zinc-400">
                            <input
                              type="checkbox"
                              checked={m.capabilities.includes(cap)}
                              onChange={() => toggleCap(v, m.model, cap)}
                            />
                            {CAP_LABEL[cap]}
                          </label>
                        ))}
                        <button type="button" className="text-zinc-600 hover:text-red-400" onClick={() => removeModel(v, m.model)}>移除</button>
                      </div>
                    ))}
                  </div>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => saveVendor(v)}>保存此供应商</Button>
                </div>
              );
            })}
            <div className="flex gap-2">
              <select value={addKind} onChange={(e) => setAddKind(e.target.value)} className="settings-input h-9 rounded-md bg-transparent border px-2 text-sm">
                {(['ollama', 'imagen', 'qwen3tts', 'grok'] as const).map((id) => {
                  const k: IntegrationManifest = getIntegration(id);
                  return <option key={k.id} value={k.id}>{k.label}</option>;
                })}
              </select>
              <Button variant="outline" onClick={addVendor}>添加供应商</Button>
            </div>
          </section>

          <section className="space-y-3">
            <div className="text-xs font-medium text-zinc-300">当前使用</div>
            {([
              ['chat', '聊天'],
              ['image.generate', '生图'],
              ['image.edit', '改图'],
              ['speech', '朗读'],
            ] as Array<[Capability, string]>).map(([cap, label]) => {
              const options = modelsFor(cap);
              const cur = bindingFor(cap);
              const value = cur ? `${cur.vendor_id}::${cur.model}` : '';
              return (
                <Field key={cap} label={label} hint={integrationsFor(cap).map((i) => i.label).join(' / ')}>
                  <select
                    className="settings-input mt-1 w-full h-9 rounded-md bg-transparent border px-2 text-sm"
                    value={value}
                    onChange={(e) => {
                      const [vendor_id, model] = e.target.value.split('::');
                      if (vendor_id && model) bind(cap, vendor_id, model);
                    }}
                  >
                    <option value="">沿用默认 / 旧设置</option>
                    {options.map((o) => (
                      <option key={`${o.vendor.id}::${o.model}`} value={`${o.vendor.id}::${o.model}`}>
                        {o.vendor.label} / {o.model}
                      </option>
                    ))}
                  </select>
                </Field>
              );
            })}
          </section>

          <section className="space-y-3">
            <div className="text-xs font-medium text-zinc-300">生成参数</div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Temperature">
                <Input value={form.temperature || '0.7'} onChange={(e) => set('temperature', e.target.value)} className="settings-input mt-1" />
              </Field>
              <Field label="Max Tokens">
                <Input value={form.max_tokens || '4096'} onChange={(e) => set('max_tokens', e.target.value)} className="settings-input mt-1" />
              </Field>
            </div>
          </section>

          <div className="flex flex-wrap gap-2 pt-2">
            <Button onClick={handleSave} className="flex-1 min-w-[120px]">保存</Button>
            <Button variant="outline" onClick={() => test('chat')} disabled={!!testing}>测试聊天</Button>
            <Button variant="outline" onClick={() => test(genKind === 'imagen' ? 'jetson' : 'image')} disabled={!!testing}>测试生图</Button>
            <Button variant="outline" onClick={() => test('tts')} disabled={!!testing}>测试朗读就绪</Button>
            <Button
              variant="outline"
              disabled={ttsPreviewing}
              onClick={async () => {
                setTtsPreviewing(true);
                try {
                  const Ctx = window.AudioContext || (window as any).webkitAudioContext;
                  const ctx = Ctx ? new Ctx() : undefined;
                  if (ctx?.state === 'suspended') await ctx.resume();
                  const res = await fetch('/api/tts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: '这是朗读测试。' }),
                  });
                  if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    throw new Error(data.error || `HTTP ${res.status}`);
                  }
                  const clone = res.clone();
                  const { playAudioResponse } = await import('@/app/lib/wav-stream-player');
                  await playAudioResponse(res, { ctx });
                  const blob = await clone.blob();
                  if (ttsPreviewUrl) URL.revokeObjectURL(ttsPreviewUrl);
                  setTtsPreviewUrl(URL.createObjectURL(blob));
                } catch (e: any) {
                  setTestResult({ ok: false, error: e.message });
                } finally {
                  setTtsPreviewing(false);
                }
              }}
            >
              {ttsPreviewing ? '试听中…' : '试听一句'}
            </Button>
          </div>
          {ttsPreviewUrl && (
            <audio className="w-full" controls src={ttsPreviewUrl} />
          )}
          {testResult && (
            <div className="text-xs p-2 bg-zinc-900 rounded break-all">
              {testResult.ok ? '连接成功' : '连接失败'}: {JSON.stringify(testResult).slice(0, 300)}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
