'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Edit3,
  Image as ImageIcon,
  Loader2,
  MessageCircle,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { describeFromSettings } from '@/app/lib/integrations/catalog';
import type { AppSettings, Conversation, GalleryImage } from '@/app/lib/types';

const KINDS: Array<{ id: '' | 'generate' | 'edit' | 'upload'; label: string }> = [
  { id: '', label: '全部' },
  { id: 'generate', label: '生图' },
  { id: 'edit', label: '改图' },
  { id: 'upload', label: '上传' },
];

const ASPECTS = ['1:1', '16:9', '9:16', '4:3', '3:4'];

function failMsg(prefix: string, data: any) {
  const err = String(data?.error || '');
  if (err.includes('policy') || err.includes('content')) return `${prefix}：提示词可能违反内容政策`;
  if (err.includes('rate') || err.includes('429')) return `${prefix}：请求太频繁，请稍后再试`;
  return `${prefix}：${data?.body?.error?.message || err || '未知错误'}`;
}

function convLabel(img: GalleryImage) {
  const title = (img.conversation_title || '').replace(/\s+/g, ' ').trim();
  return title || '未归类会话';
}

export default function GalleryView() {
  const { toast } = useToast();
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [total, setTotal] = useState(0);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [kind, setKind] = useState<'' | 'generate' | 'edit' | 'upload'>('');
  const [filterConv, setFilterConv] = useState('');
  const [q, setQ] = useState('');
  const [qDraft, setQDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [editPrompt, setEditPrompt] = useState('');
  const [genPrompt, setGenPrompt] = useState('');
  const [aspect, setAspect] = useState('1:1');
  const [targetConvId, setTargetConvId] = useState('');
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<Set<string>>(new Set());

  const active = settings?.active || (settings ? describeFromSettings(settings) : null);
  const canEdit = !!active?.edit.available;
  const previewIndex = images.findIndex((i) => i.id === previewId);
  const preview = previewIndex >= 0 ? images[previewIndex] : null;
  const viewing = useMemo(
    () => images.filter((i) => i.status === 'completed' && i.file_path),
    [images]
  );

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (kind) params.set('kind', kind);
    if (filterConv) params.set('conversation_id', filterConv);
    if (q) params.set('q', q);
    params.set('status', 'all');
    params.set('limit', '400');
    const res = await fetch(`/api/images?${params}`);
    const data = await res.json();
    setImages(data.images || []);
    setTotal(data.total || 0);
    setLoading(false);
  }, [kind, filterConv, q]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    fetch('/api/conversations')
      .then((r) => r.json())
      .then((rows: Conversation[]) => {
        setConversations(rows);
        setTargetConvId((prev) => prev || rows[0]?.id || '');
      })
      .catch(() => {});
    fetch('/api/settings')
      .then((r) => r.json())
      .then(setSettings)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (filterConv) setTargetConvId(filterConv);
  }, [filterConv]);

  async function pollUntilDone(id: string) {
    if (pollRef.current.has(id)) return;
    pollRef.current.add(id);
    try {
      for (let i = 0; i < 180; i++) {
        const res = await fetch(`/api/images/${id}`);
        if (!res.ok) break;
        const img = await res.json();
        setImages((prev) => {
          const next = prev.map((x) => (x.id === id ? { ...x, ...img } : x));
          return next.some((x) => x.id === id) ? next : [{ ...img, conversation_title: img.conversation_title || null }, ...next];
        });
        if (img.status === 'completed') {
          setPreviewId(id);
          return;
        }
        if (img.status === 'error') {
          toast({ title: '生成失败', description: img.error_message || '任务失败', variant: 'error' });
          return;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    } finally {
      pollRef.current.delete(id);
    }
  }

  async function ensureConv(): Promise<string | null> {
    if (targetConvId) return targetConvId;
    const res = await fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '画廊' }),
    });
    if (!res.ok) return null;
    const conv = await res.json();
    setConversations((prev) => [conv, ...prev]);
    setTargetConvId(conv.id);
    return conv.id;
  }

  async function generate() {
    const prompt = genPrompt.trim();
    if (!prompt || busy) return;
    const conversation_id = await ensureConv();
    if (!conversation_id) {
      toast({ title: '没有会话', description: '先去工作室建一个会话，或点生图时会自动建「画廊」', variant: 'error' });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/images/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          conversation_id,
          aspect_ratio: aspect,
          resolution: settings?.default_resolution || '1k',
          n: settings?.default_n || '1',
        }),
      });
      const data = await res.json();
      if (data.error) {
        toast({ title: '生成失败', description: failMsg('生成失败', data), variant: 'error' });
        return;
      }
      const convTitle = conversations.find((c) => c.id === conversation_id)?.title || '画廊';
      const incoming: GalleryImage[] = (data.images || []).map((img: GalleryImage) => ({
        ...img,
        conversation_title: convTitle,
      }));
      setImages((prev) => [...incoming, ...prev]);
      setTotal((n) => n + incoming.length);
      setGenPrompt('');
      for (const img of incoming) {
        if (img.status === 'pending') void pollUntilDone(img.id);
        else setPreviewId(img.id);
      }
    } catch (e: any) {
      toast({ title: '生成失败', description: e.message, variant: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function editCurrent() {
    if (!preview || busy) return;
    if (preview.status === 'pending' || preview.status === 'error' || !preview.file_path) return;
    if (!canEdit) {
      toast({
        title: '无法改图',
        description: active?.edit.reason || '当前集成不支持改图',
        variant: 'error',
      });
      return;
    }
    const prompt = editPrompt.trim() || preview.prompt || '继续优化';
    setBusy(true);
    try {
      const res = await fetch('/api/images/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          image_id: preview.id,
          conversation_id: preview.conversation_id,
          aspect_ratio: aspect,
          resolution: settings?.default_resolution || '1k',
        }),
      });
      const data = await res.json();
      if (data.error) {
        toast({ title: '改图失败', description: failMsg('改图失败', data), variant: 'error' });
        return;
      }
      const incoming: GalleryImage[] = (data.images || []).map((img: GalleryImage) => ({
        ...img,
        conversation_title: preview.conversation_title,
      }));
      setImages((prev) => [...incoming, ...prev]);
      setTotal((n) => n + incoming.length);
      setEditPrompt('');
      if (incoming[0]) {
        setPreviewId(incoming[0].id);
        if (incoming[0].status === 'pending') void pollUntilDone(incoming[0].id);
      }
    } catch (e: any) {
      toast({ title: '改图失败', description: e.message, variant: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function removeOne(id: string, skipConfirm = false) {
    if (!skipConfirm && !confirm('确定删除这张图？文件会一起删掉。')) return false;
    const res = await fetch(`/api/images/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      toast({ title: '删除失败', variant: 'error' });
      return false;
    }
    setImages((prev) => prev.filter((x) => x.id !== id));
    setTotal((n) => Math.max(0, n - 1));
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    return true;
  }

  async function removePreview() {
    if (!preview) return;
    const idx = previewIndex;
    const ok = await removeOne(preview.id);
    if (!ok) return;
    toast({ title: '已删除', variant: 'default' });
    const rest = images.filter((x) => x.id !== preview.id);
    if (!rest.length) setPreviewId(null);
    else setPreviewId(rest[Math.min(idx, rest.length - 1)].id);
  }

  async function removeSelected() {
    if (!selected.size) return;
    if (!confirm(`确定删除 ${selected.size} 张？文件会一起删掉。`)) return;
    const ids = [...selected];
    let n = 0;
    for (const id of ids) {
      if (await removeOne(id, true)) n++;
    }
    setSelected(new Set());
    setSelectMode(false);
    if (previewId && ids.includes(previewId)) setPreviewId(null);
    toast({ title: `已删除 ${n} 张`, variant: 'default' });
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openPreview(img: GalleryImage) {
    if (selectMode) {
      toggleSelect(img.id);
      return;
    }
    if (img.status !== 'completed' || !img.file_path) return;
    setPreviewId(img.id);
    setEditPrompt('');
  }

  function stepPreview(dir: number) {
    const list = viewing.length ? viewing : images;
    if (!list.length || previewIndex < 0) return;
    const ids = list.map((i) => i.id);
    const at = ids.indexOf(previewId || '');
    const next = ids[(at + dir + ids.length) % ids.length];
    setPreviewId(next);
    setEditPrompt('');
  }

  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') stepPreview(-1);
      else if (e.key === 'ArrowRight') stepPreview(1);
      else if (e.key === 'Escape') setPreviewId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [preview, previewId, images]);

  function download(img: GalleryImage) {
    const a = document.createElement('a');
    a.href = `/api/files/${img.file_path}`;
    a.download = `${(img.prompt || 'image').slice(0, 30)}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  const shown = images;

  return (
    <div className="flex h-dvh flex-col bg-black text-zinc-200">
      <header className="shrink-0 border-b border-white/5 bg-black/80 backdrop-blur-md">
        <div className="flex items-center gap-2 px-3 py-2 md:px-5">
          <Link
            href="/"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-sm text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">工作室</span>
          </Link>
          <div className="min-w-0">
            <div className="text-sm font-medium tracking-tight">画廊</div>
            <div className="hidden text-[10px] text-zinc-500 sm:block">
              {total} 张 · 点图欣赏，悬停可删
            </div>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant={selectMode ? 'secondary' : 'ghost'}
              size="sm"
              className="h-8"
              onClick={() => {
                setSelectMode((v) => !v);
                setSelected(new Set());
              }}
            >
              {selectMode ? '完成' : '整理'}
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto px-3 pb-2 md:px-5">
          {KINDS.map((k) => (
            <button
              key={k.id || 'all'}
              onClick={() => setKind(k.id)}
              className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs transition ${
                kind === k.id
                  ? 'border-white/20 bg-white text-black'
                  : 'border-white/10 text-zinc-400 hover:border-white/20 hover:text-zinc-200'
              }`}
            >
              {k.label}
            </button>
          ))}
          <select
            value={filterConv}
            onChange={(e) => setFilterConv(e.target.value)}
            className="h-7 max-w-[160px] shrink-0 rounded-full border border-white/10 bg-transparent px-2 text-xs text-zinc-300 outline-none"
          >
            <option value="">所有会话</option>
            {conversations.map((c) => (
              <option key={c.id} value={c.id}>
                {(c.title || '未命名').replace(/\s+/g, ' ').slice(0, 24)}
              </option>
            ))}
          </select>
          <form
            className="ml-auto flex min-w-[140px] max-w-xs flex-1 items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              setQ(qDraft.trim());
            }}
          >
            <Search className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
            <input
              value={qDraft}
              onChange={(e) => setQDraft(e.target.value)}
              placeholder="搜提示词 / 会话"
              className="h-7 w-full bg-transparent text-xs text-zinc-200 outline-none placeholder:text-zinc-600"
            />
            {q && (
              <button
                type="button"
                className="text-zinc-500"
                onClick={() => {
                  setQ('');
                  setQDraft('');
                }}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </form>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-2 py-3 md:px-4 md:py-5">
        {loading && (
          <div className="flex h-40 items-center justify-center text-sm text-zinc-500">载入画廊…</div>
        )}
        {!loading && shown.length === 0 && (
          <div className="flex h-[60vh] flex-col items-center justify-center gap-2 text-zinc-500">
            <ImageIcon className="h-8 w-8 text-zinc-700" />
            <div className="text-sm">还没有可欣赏的画</div>
            <div className="text-xs">下面输入描述就能生图</div>
          </div>
        )}
        <div className="columns-2 gap-2 sm:columns-3 lg:columns-4 xl:columns-5 2xl:columns-6">
          {shown.map((img) => {
            const pending = img.status === 'pending';
            const errored = img.status === 'error';
            const picked = selected.has(img.id);
            return (
              <div
                key={img.id}
                role="button"
                tabIndex={0}
                onClick={() => openPreview(img)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openPreview(img);
                  }
                }}
                className={`mb-2 w-full break-inside-avoid overflow-hidden rounded-lg text-left transition ${
                  picked ? 'ring-2 ring-white' : 'ring-0'
                } ${pending || errored ? 'bg-zinc-900' : 'bg-zinc-950'}`}
              >
                <div className="group relative">
                  {pending ? (
                    <div className="flex aspect-[3/4] items-center justify-center bg-zinc-900">
                      <Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
                    </div>
                  ) : errored ? (
                    <div className="flex aspect-square flex-col justify-end bg-red-950/40 p-3">
                      <div className="text-xs text-red-300">失败</div>
                      <div className="mt-1 line-clamp-3 text-[10px] text-zinc-400">{img.prompt}</div>
                    </div>
                  ) : (
                    <img
                      src={`/api/files/${img.thumb_path || img.file_path}`}
                      alt={img.prompt || ''}
                      className="block w-full bg-zinc-900 object-cover"
                      loading="lazy"
                    />
                  )}
                  {!pending && !errored && (
                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent opacity-0 transition group-hover:opacity-100 group-focus:opacity-100" />
                  )}
                  {selectMode && (
                    <div className={`absolute left-2 top-2 flex h-5 w-5 items-center justify-center rounded-full border ${
                      picked ? 'border-white bg-white text-black' : 'border-white/50 bg-black/40'
                    }`}>
                      {picked ? <Check className="h-3 w-3" /> : null}
                    </div>
                  )}
                  {!selectMode && !pending && !errored && (
                    <button
                      type="button"
                      className="absolute right-2 top-2 rounded-full bg-black/55 p-1.5 text-zinc-200 opacity-100 md:opacity-0 md:group-hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        void removeOne(img.id).then((ok) => {
                          if (ok) toast({ title: '已删除', variant: 'default' });
                        });
                      }}
                      aria-label="删除"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <div className="px-2 pb-2 pt-1.5">
                  <div className="truncate text-[11px] text-zinc-400">{convLabel(img)}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {selectMode && selected.size > 0 && (
        <div className="shrink-0 border-t border-white/10 bg-zinc-950 px-4 py-2">
          <div className="flex items-center gap-2">
            <div className="text-sm text-zinc-300">已选 {selected.size} 张</div>
            <div className="flex-1" />
            <Button variant="destructive" size="sm" onClick={() => void removeSelected()}>
              <Trash2 className="mr-1 h-4 w-4" /> 删除
            </Button>
          </div>
        </div>
      )}

      {!selectMode && (
        <div className="shrink-0 border-t border-white/10 bg-zinc-950/95 px-3 py-2 backdrop-blur md:px-5">
          <div className="mb-1.5 flex items-center gap-1.5 overflow-x-auto">
            {ASPECTS.map((r) => (
              <button
                key={r}
                onClick={() => setAspect(r)}
                className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${
                  aspect === r ? 'border-white bg-white text-black' : 'border-white/10 text-zinc-500'
                }`}
              >
                {r}
              </button>
            ))}
            <select
              value={targetConvId}
              onChange={(e) => setTargetConvId(e.target.value)}
              className="ml-auto h-6 max-w-[180px] shrink-0 rounded-full border border-white/10 bg-transparent px-2 text-[10px] text-zinc-400 outline-none"
            >
              {conversations.length === 0 && <option value="">将新建「画廊」会话</option>}
              {conversations.map((c) => (
                <option key={c.id} value={c.id}>
                  生到 {(c.title || '未命名').replace(/\s+/g, ' ').slice(0, 20)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end gap-2">
            <Textarea
              className="min-h-[40px] max-h-24 flex-1 resize-y border-white/10 bg-transparent text-sm"
              placeholder="描述一张新图…"
              value={genPrompt}
              onChange={(e) => setGenPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void generate();
                }
              }}
              disabled={busy}
            />
            <Button className="h-10 px-4" onClick={() => void generate()} disabled={busy || !genPrompt.trim()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
              <span className="ml-1 hidden sm:inline">生图</span>
            </Button>
          </div>
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black">
          <header className="flex shrink-0 items-center gap-2 border-b border-white/10 px-3 py-2">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setPreviewId(null)}>
              <X className="h-4 w-4" />
            </Button>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-zinc-200">{convLabel(preview)}</div>
              <div className="text-[10px] text-zinc-500">
                {previewIndex + 1}/{images.length}
                {preview.aspect_ratio ? ` · ${preview.aspect_ratio}` : ''}
                {preview.model ? ` · ${preview.model}` : ''}
              </div>
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => stepPreview(-1)} disabled={images.length < 2}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => stepPreview(1)} disabled={images.length < 2}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => download(preview)}>
              <Download className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-red-400" onClick={() => void removePreview()}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </header>

          <div className="relative min-h-0 flex-1 bg-black">
            {preview.status === 'pending' ? (
              <div className="flex h-full items-center justify-center text-zinc-500">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" /> 生成中
              </div>
            ) : preview.file_path ? (
              <img
                src={`/api/files/${preview.file_path}`}
                alt={preview.prompt || ''}
                className="h-full w-full object-contain"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-red-400">
                {preview.error_message || '无法显示'}
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-white/10 bg-zinc-950 px-3 py-3 md:px-5">
            <p className="mb-2 max-h-16 overflow-auto text-xs leading-relaxed text-zinc-400">
              {preview.prompt || '（无提示词）'}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <Textarea
                className="min-h-[40px] max-h-20 flex-1 resize-y border-white/10 text-sm"
                placeholder={canEdit ? '改图指令，留空则用原提示词' : (active?.edit.reason || '当前不能改图')}
                value={editPrompt}
                onChange={(e) => setEditPrompt(e.target.value)}
                disabled={busy || !canEdit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void editCurrent();
                  }
                }}
              />
              <div className="flex shrink-0 gap-2">
                <Button
                  variant="secondary"
                  className="h-10"
                  disabled={busy || !canEdit || preview.status !== 'completed'}
                  onClick={() => void editCurrent()}
                >
                  <Edit3 className="mr-1 h-4 w-4" /> 改图
                </Button>
                <Link
                  href={`/?c=${encodeURIComponent(preview.conversation_id)}&img=${encodeURIComponent(preview.id)}`}
                  className="inline-flex h-10 items-center rounded-lg bg-white px-3 text-sm font-medium text-black hover:bg-zinc-200"
                >
                  <MessageCircle className="mr-1 h-4 w-4" /> 去对话
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
