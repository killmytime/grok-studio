'use client';

import { useState, useEffect, useRef } from 'react';
import ConversationList from './components/ConversationList';
import MessageItem from './components/MessageItem';
import ImagePanel from './components/ImagePanel';
import SettingsDrawer from './components/SettingsDrawer';
import ActiveBackendsBar from './components/ActiveBackendsBar';
import { describeFromSettings } from './lib/integrations/catalog';
import { formatElapsedMs } from './lib/format-elapsed';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Send, Image as ImageIcon, Edit3, X, ChevronLeft, ChevronRight, Download, Copy, Menu, Image, MessageCircle, ChevronDown, ChevronUp, Trash2, MoreHorizontal, ShieldAlert, Images, RotateCw } from 'lucide-react';
import type { Conversation, Message, ImageAsset, AppSettings } from './lib/types';
import { useToast } from '@/components/ui/toast';
import Link from 'next/link';
import { ASPECT_RATIOS, RESOLUTIONS, normalizeResolution } from './lib/image-presets';
import ViewerImage from './components/ViewerImage';
import { useViewerRotation } from './components/useViewerRotation';

const resumingUserTurns = new Set<string>();

export default function GrokStudio() {
  const { toast } = useToast();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConvId, setCurrentConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageDisplayLimit, setMessageDisplayLimit] = useState(20);
  const [images, setImages] = useState<ImageAsset[]>([]);
  const [currentImage, setCurrentImage] = useState<ImageAsset | null>(null);
  const [previewImage, setPreviewImage] = useState<ImageAsset | null>(null);
  const [showImageDetails, setShowImageDetails] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [isNSFW, setIsNSFW] = useState(false);

  const [input, setInput] = useState('');
  const [selectedAspect, setSelectedAspect] = useState('1:1');
  const [selectedResolution, setSelectedResolution] = useState('1k');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [settings, setSettings] = useState<AppSettings>({
    base_url: '', api_key: '', chat_model: 'grok-latest', image_model: 'grok-imagine-image-2.0',
    default_aspect_ratio: '1:1', default_resolution: '1k', default_n: '1', edit_compatibility_mode: 'json',
    chat_provider: 'grok', chat_base_url: '', chat_api_key: '',
    image_generate_provider: 'grok', image_generate_base_url: '', image_generate_api_key: '',
    image_edit_provider: 'grok', image_edit_base_url: '', image_edit_api_key: '',
    jetson_gateway_url: '', jetson_api_key: '', jetson_steps: '', jetson_seed: '',
    summary_prompt: `请用中文将以下对话历史压缩成一段简洁的摘要（200-300字以内），保留：
- 用户的核心偏好、设定、角色关系
- 已讨论的重要事实和决定
- 当前的剧情/任务进度
不要添加多余的解释，直接输出摘要正文。`
  });

  // Responsive & sidebar states
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(true);
  const [mobileTab, setMobileTab] = useState<'chat' | 'images'>('chat');
  const [showConvDialog, setShowConvDialog] = useState(false);

  const chatContainerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const imageAbortRef = useRef<AbortController | null>(null);
  const imagePollRef = useRef<Set<string>>(new Set());
  const messagePollRef = useRef<Set<string>>(new Set());
  const deepLinkImg = useRef(false);
  const imageBusy = isGenerating || images.some(i => i.status === 'pending');
  const activeBackends = settings.active || describeFromSettings(settings);
  const canEditImages = !!activeBackends.edit.available;
  const { rotation, cycle: rotatePreview } = useViewerRotation(!!previewImage, previewImage?.id);

  // Load initial data
  useEffect(() => {
    loadConversations();
    loadSettings();
  }, []);

  useEffect(() => {
    if (currentConvId) {
      loadMessages(currentConvId, { resume: true });
      loadImages(currentConvId);
    } else {
      setMessages([]);
      setImages([]);
      setCurrentImage(null);
    }
  }, [currentConvId]);

  useEffect(() => {
    if (deepLinkImg.current || !images.length) return;
    const imgId = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('img') : null;
    if (!imgId) return;
    const idx = images.findIndex((i) => i.id === imgId);
    if (idx < 0) return;
    deepLinkImg.current = true;
    setCurrentImage(images[idx]);
    setPreviewIndex(idx);
    setPreviewImage(images[idx]);
  }, [images]);

  const scrollToBottom = () => {
    setTimeout(() => {
      chatContainerRef.current?.scrollTo({ top: chatContainerRef.current.scrollHeight, behavior: 'smooth' });
    }, 50);
  };

  async function loadConversations() {
    const res = await fetch('/api/conversations');
    const data = await res.json();
    setConversations(data);
    const wanted = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('c') : null;
    setCurrentConvId((prev) => {
      if (wanted && data.some((x: Conversation) => x.id === wanted)) return wanted;
      if (prev) return prev;
      return data[0]?.id ?? null;
    });
  }

  async function loadMessages(convId: string, opts?: { resume?: boolean }) {
    const res = await fetch(`/api/conversations/${convId}/messages`);
    const data = await res.json();
    setMessages(data);
    setMessageDisplayLimit(20); // 默认只显示最近20条，避免长对话卡顿
    scrollToBottom();
    if (opts?.resume) void resumeIncompleteChat(convId, data);
  }

  async function pollMessageUntilDone(convId: string, messageId: string) {
    if (messagePollRef.current.has(messageId)) return;
    messagePollRef.current.add(messageId);
    setIsStreaming(true);
    try {
      for (let i = 0; i < 300; i++) {
        const res = await fetch(`/api/conversations/${convId}/messages`);
        if (!res.ok) break;
        const data: Message[] = await res.json();
        const msg = data.find((m) => m.id === messageId);
        if (!msg) return;
        setMessages(data);
        if (msg.status === 'completed') {
          await loadConversations();
          return;
        }
        if (msg.status === 'error') {
          if (msg.error_message && msg.error_message !== '已中断') {
            toast({ title: '聊天失败', description: msg.error_message, variant: 'error' });
          }
          return;
        }
        await new Promise((r) => setTimeout(r, 800));
      }
    } finally {
      messagePollRef.current.delete(messageId);
      setIsStreaming(false);
    }
  }

  async function resumeIncompleteChat(convId: string, data: Message[]) {
    const pending = data.filter((m) => m.role === 'assistant' && m.status === 'pending');
    for (const m of pending) {
      void fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: convId, pendingMessageId: m.id }),
      }).then(async (res) => {
        const type = res.headers.get('content-type') || '';
        if (type.includes('event-stream') && res.body) {
          await res.body.pipeTo(new WritableStream()).catch(() => {});
        }
      }).catch(() => {});
      void pollMessageUntilDone(convId, m.id);
    }
    if (pending.length) return;

    const last = data[data.length - 1];
    if (!last || last.role !== 'user' || last.status === 'error') return;
    if (resumingUserTurns.has(last.id)) return;
    resumingUserTurns.add(last.id);
    try {
      await streamAssistant(convId);
    } finally {
      resumingUserTurns.delete(last.id);
    }
  }

  async function loadImages(convId: string) {
    const res = await fetch(`/api/conversations/${convId}/images`);
    if (res.ok) {
      const data = await res.json();
      setImages(data);
      for (const img of data) {
        if (img.status === 'pending') pollImageUntilDone(img.id);
      }
    } else {
      setImages([]);
    }
  }

  async function pollImageUntilDone(imageId: string) {
    if (imagePollRef.current.has(imageId)) return;
    imagePollRef.current.add(imageId);
    try {
      for (let i = 0; i < 180; i++) {
        const res = await fetch(`/api/images/${imageId}`);
        if (!res.ok) break;
        const img = await res.json();
        setImages(prev => prev.map(x => x.id === imageId ? img : x));
        if (img.status === 'completed') {
          setCurrentImage(prev => (prev?.id === imageId || !prev) ? img : prev);
          return;
        }
        if (img.status === 'error') {
          toast({ title: '生成失败', description: img.error_message || '任务失败', variant: 'error' });
          return;
        }
        await new Promise(r => setTimeout(r, 1000));
      }
    } finally {
      imagePollRef.current.delete(imageId);
    }
  }

  async function loadSettings() {
    const res = await fetch('/api/settings');
    const data = await res.json();
    setSettings(data);
    if (data.default_aspect_ratio) setSelectedAspect(data.default_aspect_ratio);
    if (data.default_resolution) setSelectedResolution(normalizeResolution(data.default_resolution));
  }

  async function createNewConversation() {
    const res = await fetch('/api/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '新会话' }) });
    const conv = await res.json();
    setConversations(prev => [conv, ...prev]);
    setCurrentConvId(conv.id);
    setInput('');
  }

  async function deleteConversation(id: string) {
    await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
    setConversations(prev => prev.filter(c => c.id !== id));
    if (currentConvId === id) {
      const next = conversations.find(c => c.id !== id);
      setCurrentConvId(next ? next.id : null);
    }
  }

  async function streamAssistant(convId: string) {
    const pendingRes = await fetch(`/api/conversations/${convId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'assistant', content: '', status: 'pending' }),
    });
    if (!pendingRes.ok) throw new Error('无法创建回复');
    const pendingMsg = await pendingRes.json();
    setMessages(prev => [...prev, { ...pendingMsg, status: 'pending' as const }]);
    scrollToBottom();

    setIsStreaming(true);
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: convId,
          pendingMessageId: pendingMsg.id,
        }),
        signal: controller.signal,
      });

      const type = res.headers.get('content-type') || '';
      if (!type.includes('event-stream') || !res.body) {
        if (!res.ok) throw new Error('Chat failed');
        await pollMessageUntilDone(convId, pendingMsg.id);
        await loadMessages(convId);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const json = JSON.parse(payload);
            const delta = json.choices?.[0]?.delta?.content || '';
            if (json.studio_status === 'generating') {
              setMessages(prev =>
                prev.map(m =>
                  m.id === pendingMsg.id
                    ? { ...m, extra_json: { ...(m.extra_json || {}), drawing: true }, status: 'pending' as const }
                    : m
                )
              );
            }
            if (json.studio_image?.id) {
              const img = json.studio_image;
              setImages(prev => (prev.some(x => x.id === img.id) ? prev : [img, ...prev]));
              setMessages(prev =>
                prev.map(m => {
                  if (m.id !== pendingMsg.id) return m;
                  const images = Array.isArray(m.extra_json?.images) ? [...m.extra_json.images] : [];
                  if (!images.some((x: { id?: string }) => x.id === img.id)) images.push(img);
                  return {
                    ...m,
                    extra_json: { ...(m.extra_json || {}), images, drawing: false },
                    status: 'pending' as const,
                  };
                })
              );
              scrollToBottom();
            }
            if (delta) {
              assistantText += delta;
              setMessages(prev =>
                prev.map(m =>
                  m.id === pendingMsg.id
                    ? { ...m, content: assistantText, status: 'pending' as const }
                    : m
                )
              );
              scrollToBottom();
            }
          } catch {}
        }
      }

      await loadMessages(convId);
      await loadImages(convId);
      await loadConversations();
    } catch (e: any) {
      // 关页/断网只中断了浏览器连接，服务端还在写。不要把 pending 标成失败。
      await pollMessageUntilDone(convId, pendingMsg.id);
      await loadMessages(convId);
      await loadImages(convId);
      if (e.name !== 'AbortError') {
        const still = (await fetch(`/api/conversations/${convId}/messages`).then(r => r.json()).catch(() => [])) as Message[];
        const msg = still.find((m) => m.id === pendingMsg.id);
        if (msg?.status === 'error') {
          toast({
            title: '聊天失败',
            description: msg.error_message || e.message,
            variant: 'error',
          });
        }
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;

      const conv = conversations.find(c => c.id === convId);
      if (conv && conv.title === '新会话') {
        setTimeout(async () => {
          try {
            const res = await fetch(`/api/conversations/${convId}/summarize`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                prompt: '用 8-12 个字为这个对话取一个简短标题，不要引号，直接输出标题。',
              }),
            });
            const data = await res.json();
            if (data.summary) {
              await fetch(`/api/conversations/${convId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: data.summary }),
              });
              await loadConversations();
            }
          } catch (_) {}
        }, 800);
      }
    }
  }

  async function sendChatMessage() {
    if (!input.trim() || !currentConvId || isStreaming) return;

    const userContent = input.trim();
    setInput('');

    const userRes = await fetch(`/api/conversations/${currentConvId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'user', content: userContent }),
    });
    if (!userRes.ok) {
      setInput(userContent);
      toast({ title: '发送失败', variant: 'error' });
      return;
    }
    const userMsg = await userRes.json();
    setMessages(prev => [...prev, userMsg]);
    await streamAssistant(currentConvId);
  }

  async function generateImage(promptOverride?: string) {
    if (!currentConvId) return;
    const prompt = promptOverride || input.trim();
    if (!prompt) return;

    setIsGenerating(true);
    const controller = new AbortController();
    imageAbortRef.current = controller;

    try {
      const res = await fetch('/api/images/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          conversation_id: currentConvId,
          aspect_ratio: selectedAspect,
          resolution: selectedResolution || settings.default_resolution || '1k',
          n: settings.default_n,
        }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (data.error) {
        const msg = data.error.includes('policy') || data.error.includes('content') 
          ? '生成失败：提示词可能违反内容政策，请换个说法' 
          : data.error.includes('rate') || data.error.includes('429')
          ? '生成失败：请求太频繁，请稍后再试'
          : '生成失败：' + (data.body?.error?.message || data.error);
        toast({ title: '生成失败', description: msg, variant: 'error' });
        return;
      }

      if (data.images) {
        setImages(prev => [...data.images, ...prev]);
        for (const img of data.images) {
          if (img.status === 'pending') pollImageUntilDone(img.id);
        }
      }
      scrollToBottom();
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        toast({ title: '生成失败', description: e.message, variant: 'error' });
      }
    } finally {
      setIsGenerating(false);
      imageAbortRef.current = null;
    }
  }

  async function editImage(source: ImageAsset, editPrompt: string) {
    if (!currentConvId) return;
    if (source.status === 'pending' || source.status === 'error' || !source.file_path) return;
    if (!canEditImages) {
      toast({
        title: '无法改图',
        description: activeBackends.edit.reason || '当前集成不支持改图。Grok 是默认的改图后端。',
        variant: 'error',
      });
      return;
    }
    setIsGenerating(true);
    const controller = new AbortController();
    imageAbortRef.current = controller;

    try {
      const res = await fetch('/api/images/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: editPrompt,
          image_id: source.id,
          conversation_id: currentConvId,
          aspect_ratio: selectedAspect,
          resolution: selectedResolution || settings.default_resolution || '1k',
        }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (data.error) {
        const msg = data.error.includes('policy') || data.error.includes('content') 
          ? '改图失败：提示词可能违反内容政策' 
          : data.error.includes('rate') || data.error.includes('429')
          ? '改图失败：请求太频繁，请稍后再试'
          : '改图失败：' + (data.body?.error?.message || data.error);
        toast({ title: '改图失败', description: msg, variant: 'error' });
        return;
      }

      if (data.images) {
        setImages(prev => [...data.images, ...prev]);
        setCurrentImage(data.images[0] || null);
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        toast({ title: '改图失败', description: e.message, variant: 'error' });
      }
    } finally {
      setIsGenerating(false);
      imageAbortRef.current = null;
    }
  }

  function stopGeneration() {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    if (imageAbortRef.current) {
      imageAbortRef.current.abort();
    }
    messages
      .filter((m) => m.role === 'assistant' && m.status === 'pending')
      .forEach((m) => {
        fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cancel: true, pendingMessageId: m.id }),
        }).catch(() => {});
      });
    const pending = images.filter(i => i.status === 'pending');
    pending.forEach(img => {
      fetch(`/api/images/${img.id}/cancel`, { method: 'POST' }).then(async res => {
        if (!res.ok) return;
        const updated = await res.json();
        setImages(prev => prev.map(x => x.id === img.id ? updated : x));
      }).catch(() => {});
    });
    setIsStreaming(false);
    setIsGenerating(false);
  }

  function retryImage(image: ImageAsset) {
    // Simple retry: use its prompt to generate again
    generateImage(image.prompt);
    // Optionally remove the error one, but keep for now
  }

  async function maybeTriggerSummarize(convId: string) {
    try {
      const res = await fetch(`/api/conversations/${convId}/summarize`, { method: 'POST' });
      const data = await res.json();
      if (data.summary) {
        setConversations(prev =>
          prev.map(c =>
            c.id === convId
              ? { ...c, summary: data.summary, summary_updated_at: new Date().toISOString() }
              : c
          )
        );
        toast({ title: '记忆已更新', variant: 'default' });
      } else if (data.error) {
        toast({ title: '摘要失败', description: data.error, variant: 'error' });
      } else {
        toast({ title: '还不用摘要', description: '对话还没长到需要压缩', variant: 'default' });
      }
    } catch (e) {
      console.warn('Summarize failed', e);
    }
  }

  async function saveSettings(newSettings: Partial<AppSettings>) {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newSettings),
    });
    await loadSettings();
  }

  async function renameConversation(id: string, newTitle: string) {
    await fetch(`/api/conversations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle }),
    });
    setConversations(prev => prev.map(c => c.id === id ? { ...c, title: newTitle } : c));
  }

  async function testConnection(type: 'chat' | 'image' | 'jetson' | 'tts') {
    const res = await fetch('/api/health', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type }),
    });
    return res.json();
  }

  async function deleteMessage(messageId: string) {
    if (!currentConvId) return;
    await fetch(`/api/conversations/${currentConvId}/messages`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId }),
    });
    setMessages(prev => prev.filter(m => m.id !== messageId));
  }

  async function editMessage(messageId: string, newContent: string) {
    if (!currentConvId || isStreaming) return;
    await fetch(`/api/conversations/${currentConvId}/messages`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId, content: newContent }),
    });
    await fetch(`/api/conversations/${currentConvId}/messages`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId, after: true }),
    });
    setMessages(prev => {
      const idx = prev.findIndex(m => m.id === messageId);
      if (idx === -1) return prev;
      return [...prev.slice(0, idx), { ...prev[idx], content: newContent }];
    });
    await streamAssistant(currentConvId);
  }

  const handleSelectImage = (img: ImageAsset | null) => {
    setCurrentImage(img);
  };

  async function handleUpload(file: File) {
    if (!currentConvId) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      const b64 = (e.target?.result as string).split(',')[1];
      const res = await fetch('/api/images/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: currentConvId, b64, prompt: file.name }),
      });
      const data = await res.json();
      if (data.image) {
        setImages(prev => [data.image, ...prev]);
      }
    };
    reader.readAsDataURL(file);
  }

  const handlePreview = (img: ImageAsset) => {
    const index = images.findIndex(i => i.id === img.id);
    setPreviewIndex(index);
    setPreviewImage(img);
  };

  const closePreview = () => {
    setPreviewImage(null);
    setShowImageDetails(false);
    setIsNSFW(false);
  };

  const changePreview = (direction: number) => {
    if (images.length === 0) return;
    const newIndex = (previewIndex + direction + images.length) % images.length;
    setPreviewIndex(newIndex);
    setPreviewImage(images[newIndex]);
    setShowImageDetails(false);
    setIsNSFW(false); // 切换图片时重置 NSFW 状态
  };

  // 键盘导航（左右上下）
  useEffect(() => {
    if (!previewImage) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        changePreview(-1);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        changePreview(1);
      } else if (e.key === 'Escape') {
        closePreview();
      } else if (e.key.toLowerCase() === 'd' && e.metaKey) {
        e.preventDefault();
        handleDeletePreviewImage();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewImage, previewIndex, images]);

  // 全局粘贴上传图片支持（复制粘贴图片后直接上传到当前会话）
  useEffect(() => {
    if (!currentConvId) return;

    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            await handleUpload(file);
            toast({ title: '图片已上传', description: '已添加到图片资产，可选中后编辑', variant: 'default' });
            return;
          }
        }
      }
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [currentConvId]);

  // 触摸滑动支持（左右上下）
  let touchStartX = 0;
  let touchStartY = 0;

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const deltaX = e.changedTouches[0].screenX - touchStartX;
    const deltaY = e.changedTouches[0].screenY - touchStartY;

    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    if (absX > absY && absX > 50) {
      // 左右滑动
      changePreview(deltaX > 0 ? -1 : 1);
    } else if (absY > absX && absY > 50) {
      // 上下滑动
      if (deltaY < 0) {
        setShowImageDetails(true); // 上滑展开详情
      } else {
        setShowImageDetails(false); // 下滑收起
      }
    }
  };

  const handleDeletePreviewImage = async () => {
    if (!previewImage) return;
    if (!confirm('确定要永久删除这张图片吗？文件和记录将被物理删除，无法恢复。')) return;

    try {
      const res = await fetch(`/api/images/${previewImage.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('删除失败');

      // 从本地状态移除
      setImages(prev => prev.filter(img => img.id !== previewImage.id));

      // 如果当前选中的是被删除的图片，清空
      if (currentImage?.id === previewImage.id) {
        setCurrentImage(null);
      }

      toast({ title: '图片已删除', description: '文件和数据库记录已物理删除', variant: 'default' });
      closePreview();
    } catch (e: any) {
      toast({ title: '删除失败', description: e.message || '请稍后重试', variant: 'error' });
    }
  };

  const handleEditFromPanel = (img: ImageAsset) => {
    toast({ title: '编辑图片', description: '使用原prompt进行修改（提示输入已由toast替代native dialog）', variant: 'default' });
    const editPrompt = img.prompt || '基于原图修改';
    if (editPrompt) {
      editImage(img, editPrompt);
    }
  };

  async function retryMessage(messageId: string) {
    if (!currentConvId || isStreaming) return;

    const msgIndex = messages.findIndex(m => m.id === messageId);
    if (msgIndex === -1) return;
    const targetMsg = messages[msgIndex];

    if (targetMsg.role === 'assistant') {
      await fetch(`/api/conversations/${currentConvId}/messages`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId, after: true }),
      });
      await fetch(`/api/conversations/${currentConvId}/messages`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId }),
      });
      setMessages(prev => prev.slice(0, msgIndex));
    } else {
      await fetch(`/api/conversations/${currentConvId}/messages`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId, after: true }),
      });
      setMessages(prev => prev.slice(0, msgIndex + 1));
    }
    await streamAssistant(currentConvId);
  }

  const currentConv = conversations.find(c => c.id === currentConvId);

  return (
    <div className="flex h-dvh overflow-hidden bg-zinc-950 text-zinc-200">
      {/* Left Sidebar: Conversations - Desktop collapsible, Mobile via Dialog */}
      <div 
        className={`hidden md:flex flex-col border-r border-zinc-800 transition-all duration-200 overflow-hidden ${leftSidebarOpen ? 'w-64' : 'w-0'}`}
      >
        <ConversationList
          conversations={conversations}
          currentId={currentConvId}
          onSelect={(id) => {
            setCurrentConvId(id);
            setShowConvDialog(false);
          }}
          onNew={createNewConversation}
          onDelete={deleteConversation}
          onRename={renameConversation}
        />
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <div className="h-12 md:h-14 border-b border-zinc-800 flex items-center justify-between gap-2 px-2 md:px-4">
          <div className="flex items-center gap-1 md:gap-2 min-w-0">
            <Button 
              variant="ghost" 
              size="icon" 
              className="md:hidden h-9 w-9 shrink-0" 
              onClick={() => setShowConvDialog(true)}
            >
              <Menu className="w-5 h-5" />
            </Button>
            <Button 
              variant="ghost" 
              size="icon" 
              className="hidden md:flex h-9 w-9" 
              onClick={() => setLeftSidebarOpen(!leftSidebarOpen)}
            >
              {leftSidebarOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </Button>

            <div className="min-w-0">
              <div className="font-medium tracking-tight text-sm md:text-base truncate">Grok Studio</div>
              <div className="hidden md:block">
                <ActiveBackendsBar settings={settings} />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 md:gap-2 text-sm text-zinc-400 shrink-0">
            <Link
              href="/gallery"
              className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 md:h-8"
              title="画廊"
            >
              <Images className="h-4 w-4" />
              <span className="hidden sm:inline">画廊</span>
            </Link>
            {currentConvId && <span className="hidden lg:inline">当前会话 #{currentConvId.slice(0, 8)}</span>}
            {currentConvId && messages.length > 20 && (
              <Button 
                variant="ghost" 
                size="sm" 
                className="hidden md:inline-flex h-7 px-2 text-xs text-zinc-400 hover:text-zinc-200"
                onClick={() => maybeTriggerSummarize(currentConvId)}
              >
                手动摘要
              </Button>
            )}
            {currentConv?.summary ? (
              <Button 
                variant="ghost" 
                size="sm" 
                className="h-9 px-2 md:h-7 md:px-2 text-xs text-amber-400 hover:text-amber-300"
                onClick={() => toast({ title: '当前记忆摘要', description: currentConv.summary, variant: 'default' })}
              >
                记忆
              </Button>
            ) : null}
            <SettingsDrawer settings={settings} onSave={saveSettings} onTest={testConnection} />
            <Button 
              variant="ghost" 
              size="icon" 
              className="hidden md:flex h-9 w-9" 
              onClick={() => setRightSidebarOpen(!rightSidebarOpen)}
            >
              {rightSidebarOpen ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </Button>
          </div>
        </div>

        {/* Chat / Content Area - responsive tab on mobile */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Desktop always shows chat; Mobile respects tab */}
          <div 
            ref={chatContainerRef} 
            className={`flex-1 overflow-auto p-3 md:p-6 chat-container bg-zinc-950 ${mobileTab === 'images' ? 'hidden md:block' : 'block'}`}
          >
            {!currentConvId && (
              <div className="h-full flex items-center justify-center text-zinc-500">选择或新建一个会话开始</div>
            )}
            {currentConvId && messages.length === 0 && (
              <div className="text-center text-zinc-500 mt-12">开始聊天或点击「生成图片」</div>
            )}

            {/* 性能优化：默认只渲染最近20条，解决长对话卡顿 + 移动端新消息抖动 */}
            {messages.length > 20 && messageDisplayLimit < messages.length && (
              <button
                onClick={() => setMessageDisplayLimit(Math.min(messages.length, messageDisplayLimit + 20))}
                className="mx-auto mb-2 block text-xs px-3 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-400"
              >
                加载更早的 {Math.min(20, messages.length - messageDisplayLimit)} 条消息
              </button>
            )}

            {messages.slice(-messageDisplayLimit).map((m) => (
              <MessageItem 
                key={m.id} 
                message={m} 
                onRetry={retryMessage} 
                onDelete={deleteMessage} 
                onEdit={editMessage}
                canSpeak={!!activeBackends.speech?.available && m.role === 'assistant'}
                onAudioReady={(id, audioPath) => {
                  setMessages((prev) => prev.map((x) =>
                    x.id === id ? { ...x, extra_json: { ...(x.extra_json || {}), audio_path: audioPath } } : x
                  ));
                }}
              />
            ))}
            {isStreaming && <div className="text-xs text-zinc-500 pl-4">正在生成回复...</div>}
          </div>

          {mobileTab === 'images' && (
            <div className="flex-1 min-h-0 overflow-hidden md:hidden">
              <ImagePanel
                images={images}
                currentImage={currentImage}
                onSelectImage={(img) => { handleSelectImage(img); if (img) setMobileTab('chat'); }}
                onEditImage={handleEditFromPanel}
                onUpload={handleUpload}
                onPreview={handlePreview}
                conversationId={currentConvId}
                onRetryImage={retryImage}
                canEdit={canEditImages}
                editHint={!activeBackends.generate.supportsEdit ? `改图走 ${activeBackends.edit.label}` : undefined}
              />
            </div>
          )}
        </div>

        <div className={`border-t border-zinc-800 px-3 py-2 md:px-4 md:py-3 bg-zinc-950 ${mobileTab === 'images' ? 'hidden md:block' : 'block'}`}>
          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            <div className="text-xs text-zinc-500 shrink-0">比例</div>
            {ASPECT_RATIOS.map(ratio => (
              <button
                key={ratio}
                onClick={() => setSelectedAspect(ratio)}
                className={`px-2.5 py-0.5 text-xs rounded-full border shrink-0 transition ${
                  selectedAspect === ratio 
                    ? 'bg-blue-600 border-blue-600 text-white' 
                    : 'border-zinc-700 hover:bg-zinc-800 text-zinc-400'
                }`}
              >
                {ratio}
              </button>
            ))}
            <span className="mx-0.5 h-3 w-px shrink-0 bg-zinc-800" />
            <div className="text-xs text-zinc-500 shrink-0">画质</div>
            {RESOLUTIONS.map((r) => (
              <button
                key={r.id}
                onClick={() => setSelectedResolution(r.id)}
                className={`px-2.5 py-0.5 text-xs rounded-full border shrink-0 transition ${
                  selectedResolution === r.id
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'border-zinc-700 hover:bg-zinc-800 text-zinc-400'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          <Textarea
            className="chat-input min-h-[44px] max-h-[120px] text-base px-3 py-2 md:min-h-[48px] resize-y"
            placeholder={currentImage ? `继续改这张图... (Shift+Enter 换行)` : "输入消息或图片描述 (Shift+Enter 换行)"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (currentImage) {
                  if (canEditImages) editImage(currentImage, input.trim());
                } else {
                  sendChatMessage();
                }
              }
            }}
            disabled={isStreaming || imageBusy || !currentConvId}
          />
          <div className="mt-2 flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="h-9 px-2.5 text-xs"
              onClick={() => generateImage()}
              disabled={!input.trim() || imageBusy || !currentConvId}
            >
              <ImageIcon className="w-4 h-4 mr-1" /> 生图
            </Button>
            {currentImage && (
              <Button
                size="sm"
                variant="ghost"
                className="h-9 px-2.5 text-xs"
                onClick={() => editImage(currentImage, input.trim() || '继续优化')}
                disabled={imageBusy || !currentConvId || !canEditImages}
                title={canEditImages ? (activeBackends.generate.supportsEdit ? '改图' : `改图走 ${activeBackends.edit.label}（生图后端不支持编辑）`) : (activeBackends.edit.reason || '不支持改图')}
              >
                <Edit3 className="w-4 h-4 mr-1" /> 改图
              </Button>
            )}
            <div className="flex-1" />
            {(isStreaming || imageBusy) ? (
              <Button 
                className="h-9 px-4" 
                variant="destructive"
                onClick={stopGeneration}
              >
                中断
              </Button>
            ) : (
              <Button 
                className="h-9 px-4" 
                onClick={() => currentImage ? editImage(currentImage, input.trim()) : sendChatMessage()}
                disabled={(!input.trim() && !currentImage) || isStreaming || imageBusy || !currentConvId || (!!currentImage && !canEditImages)}
              >
                <Send className="w-4 h-4" />
              </Button>
            )}
          </div>
          <div className="hidden md:block text-[10px] text-zinc-500 mt-1.5 px-1">
            Enter 发送 · Shift+Enter 换行
            {currentImage && canEditImages && !activeBackends.generate.supportsEdit
              ? ` · 改图使用 ${activeBackends.edit.model}（${activeBackends.edit.label}）`
              : currentImage && canEditImages
                ? ' · 选中图片后可继续编辑'
                : currentImage && !canEditImages
                  ? ` · ${activeBackends.edit.reason || '当前后端不能改图'}`
                  : ' · 选中图片后可继续编辑'}
          </div>
        </div>

        <div className="md:hidden border-t border-zinc-800 bg-zinc-950 flex pb-[env(safe-area-inset-bottom)]">
          <button
            onClick={() => setMobileTab('chat')}
            className={`flex-1 flex flex-col items-center py-1.5 text-xs ${mobileTab === 'chat' ? 'text-white bg-zinc-900' : 'text-zinc-400'}`}
          >
            <MessageCircle className="w-5 h-5 mb-0.5" /> 聊天
          </button>
          <button
            onClick={() => setMobileTab('images')}
            className={`flex-1 flex flex-col items-center py-1.5 text-xs ${mobileTab === 'images' ? 'text-white bg-zinc-900' : 'text-zinc-400'}`}
          >
            <Image className="w-5 h-5 mb-0.5" /> 图片
          </button>
        </div>
      </div>

      {/* Right Sidebar: Images */}
      <div 
        className={`hidden md:flex flex-col border-l border-zinc-800 transition-all duration-200 overflow-hidden ${rightSidebarOpen ? 'w-[320px]' : 'w-0'}`}
      >
        <ImagePanel
          images={images}
          currentImage={currentImage}
          onSelectImage={handleSelectImage}
          onEditImage={handleEditFromPanel}
          onUpload={handleUpload}
          onPreview={handlePreview}
          conversationId={currentConvId}
          onRetryImage={retryImage}
          canEdit={canEditImages}
          editHint={!activeBackends.generate.supportsEdit ? `改图走 ${activeBackends.edit.label}` : undefined}
        />
      </div>

      {/* Dialogs for Mobile Sidebars */}
      <Dialog open={showConvDialog} onOpenChange={setShowConvDialog}>
        <DialogContent className="max-w-[90vw] p-0 bg-zinc-950 border-zinc-800 h-[80vh]">
          <DialogHeader className="p-4 border-b border-zinc-800">
            <DialogTitle>会话列表</DialogTitle>
          </DialogHeader>
          <div className="overflow-auto flex-1">
            <ConversationList
              conversations={conversations}
              currentId={currentConvId}
              onSelect={(id) => {
                setCurrentConvId(id);
                setShowConvDialog(false);
              }}
              onNew={() => { createNewConversation(); setShowConvDialog(false); }}
              onDelete={deleteConversation}
              onRename={renameConversation}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* 大图预览 Dialog - Header / 主预览区 / Footer 结构，图片严格适应剩余空间 */}
      <Dialog
        open={!!previewImage}
        onOpenChange={(open) => {
          if (!open) closePreview();
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="
            flex h-[100dvh] w-[100vw] max-w-none flex-col gap-0
            overflow-hidden rounded-none border-0 bg-zinc-950 p-0
            sm:h-[min(92dvh,980px)] sm:w-[min(96vw,1680px)]
            sm:max-w-[96vw] sm:rounded-xl sm:border sm:border-zinc-800
          "
        >
          {previewImage && (
            <>
              {/* Header：固定，不覆盖图片 */}
              <header
                className="
                  z-30 flex shrink-0 items-center justify-between gap-2
                  border-b border-zinc-800 bg-zinc-950/95 px-3 py-2
                  backdrop-blur-md sm:px-4
                "
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium tabular-nums text-zinc-200">
                    {previewIndex + 1}
                    <span className="mx-1 text-zinc-600">/</span>
                    {images.length}
                  </div>
                  <p className="hidden max-w-[38vw] truncate text-xs text-zinc-500 md:block">
                    {previewImage.model}
                    {previewImage.resolution ? ` · ${previewImage.resolution}` : ""}
                    {previewImage.aspect_ratio ? ` · ${previewImage.aspect_ratio}` : ""}
                  </p>
                </div>

                {/* 桌面快捷切图；移动端支持滑动 */}
                <div className="flex shrink-0 items-center gap-1">
                  <div className="hidden items-center gap-1 sm:flex">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => changePreview(-1)}
                      disabled={images.length <= 1}
                      aria-label="上一张图片"
                      title="上一张（←）"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>

                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => changePreview(1)}
                      disabled={images.length <= 1}
                      aria-label="下一张图片"
                      title="下一张（→）"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>

                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={rotatePreview}
                    aria-label="旋转图片"
                    title="旋转（手机没开自动旋转时也可横着看）"
                    data-testid="rotate-image"
                  >
                    <RotateCw className="h-4 w-4" />
                  </Button>

                  {/* 下载高频操作外露 */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5 px-2 text-zinc-300"
                    onClick={() => {
                      const fullUrl = `/api/files/${previewImage.file_path}`;
                      const a = document.createElement("a");
                      a.href = fullUrl;
                      a.download = `${previewImage.prompt.slice(0, 30) || "image"}.png`;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                    }}
                  >
                    <Download className="h-4 w-4" />
                    <span className="hidden sm:inline">下载</span>
                  </Button>

                  {/* 低频操作收进更多菜单 */}
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          aria-label="更多图片操作"
                        />
                      }
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </DropdownMenuTrigger>

                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem
                        onClick={async () => {
                          const text = previewImage.prompt || '';
                          try {
                            if (navigator.clipboard?.writeText) {
                              await navigator.clipboard.writeText(text);
                            } else {
                              const ta = document.createElement('textarea');
                              ta.value = text;
                              ta.setAttribute('readonly', '');
                              ta.style.position = 'fixed';
                              ta.style.left = '-9999px';
                              document.body.appendChild(ta);
                              ta.select();
                              document.execCommand('copy');
                              document.body.removeChild(ta);
                            }
                            toast({ title: '已复制 Prompt', variant: 'success' });
                          } catch {
                            toast({ title: '复制失败', variant: 'error' });
                          }
                        }}
                      >
                        <Copy className="mr-2 h-4 w-4" />
                        复制 Prompt
                      </DropdownMenuItem>

                      <DropdownMenuItem onClick={() => setIsNSFW(!isNSFW)}>
                        <ShieldAlert className="mr-2 h-4 w-4" />
                        {isNSFW ? "取消 NSFW 标记" : "标记为 NSFW"}
                      </DropdownMenuItem>

                      <DropdownMenuSeparator />

                      <DropdownMenuItem
                        className="text-red-400 focus:text-red-300"
                        onClick={handleDeletePreviewImage}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        删除图片
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={closePreview}
                    aria-label="关闭预览"
                    title="关闭（Esc）"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </header>

              {/* 图片主区：拥有剩余全部空间 */}
              <main
                className="
                  relative min-h-0 flex-1 overflow-hidden bg-black
                  touch-pan-y select-none
                "
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
              >
                <div className="group relative flex h-full w-full items-center justify-center p-2 sm:p-4">
                  <ViewerImage
                    key={previewImage.id}
                    thumbSrc={previewImage.thumb_path ? `/api/files/${previewImage.thumb_path}` : null}
                    fullSrc={`/api/files/${previewImage.file_path}`}
                    alt={previewImage.prompt || "图片预览"}
                    rotation={rotation}
                    onClick={() => setShowImageDetails((value) => !value)}
                    imgClassName={`
                      select-none rounded-md shadow-2xl
                      ${isNSFW ? "blur-2xl scale-105" : ""}
                    `}
                  />

                  {/* NSFW 提示独立覆盖 */}
                  {isNSFW && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <div className="rounded-full border border-red-400/30 bg-red-950/85 px-4 py-2 text-sm font-medium text-red-100 shadow-xl backdrop-blur-md">
                        NSFW · 图片已模糊
                      </div>
                    </div>
                  )}

                  {/* 悬浮翻页按钮（桌面 hover 显示） */}
                  {images.length > 1 && (
                    <>
                      <button
                        type="button"
                        onClick={() => changePreview(-1)}
                        className="
                          absolute left-2 top-1/2 z-20 -translate-y-1/2
                          rounded-full border border-white/10 bg-black/45 p-2.5
                          text-white shadow-lg backdrop-blur-sm
                          transition-all hover:bg-black/80
                          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70
                          sm:left-4 sm:opacity-0 sm:group-hover:opacity-100
                        "
                        aria-label="上一张图片"
                      >
                        <ChevronLeft className="h-5 w-5 sm:h-6 sm:w-6" />
                      </button>

                      <button
                        type="button"
                        onClick={() => changePreview(1)}
                        className="
                          absolute right-2 top-1/2 z-20 -translate-y-1/2
                          rounded-full border border-white/10 bg-black/45 p-2.5
                          text-white shadow-lg backdrop-blur-sm
                          transition-all hover:bg-black/80
                          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70
                          sm:right-4 sm:opacity-0 sm:group-hover:opacity-100
                        "
                        aria-label="下一张图片"
                      >
                        <ChevronRight className="h-5 w-5 sm:h-6 sm:w-6" />
                      </button>
                    </>
                  )}

                  {/* 点击提示 */}
                  {!showImageDetails && (
                    <div
                      className="
                        pointer-events-none absolute bottom-3 left-1/2 hidden
                        -translate-x-1/2 rounded-full bg-black/45 px-3 py-1.5
                        text-xs text-zinc-300 opacity-0 backdrop-blur-sm
                        transition-opacity group-hover:opacity-100 md:block
                      "
                    >
                      点击图片查看详情
                    </div>
                  )}
                </div>
              </main>

              {/* Footer：固定在正常流，展开只压缩主图区 */}
              <footer className="z-30 shrink-0 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur-md">
                {!showImageDetails ? (
                  <button
                    type="button"
                    onClick={() => setShowImageDetails(true)}
                    className="
                      flex w-full items-center gap-3 px-3 py-2 text-left
                      transition-colors hover:bg-zinc-900/80 sm:px-4
                    "
                    aria-expanded="false"
                  >
                    <span className="min-w-0 flex-1 truncate text-xs text-zinc-400">
                      {previewImage.prompt || "暂无 Prompt"}
                    </span>
                    <span className="flex shrink-0 items-center text-xs text-zinc-500">
                      详情
                      <ChevronUp className="ml-1 h-3.5 w-3.5" />
                    </span>
                  </button>
                ) : (
                  <div className="px-3 py-3 sm:px-4">
                    <div className="mb-3 flex items-start gap-3">
                      <p className="min-w-0 flex-1 text-sm leading-6 text-zinc-300 line-clamp-3">
                        {previewImage.prompt || "暂无 Prompt"}
                      </p>

                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 shrink-0 px-2 text-xs text-zinc-400"
                        onClick={() => setShowImageDetails(false)}
                      >
                        收起
                        <ChevronDown className="ml-1 h-3.5 w-3.5" />
                      </Button>
                    </div>

                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3 lg:grid-cols-4">
                      {[
                        ['供应商', previewImage.extra_json?.provider || '—'],
                        ['模型', previewImage.model || '—'],
                        ['类型', previewImage.kind || '—'],
                        ['耗时', formatElapsedMs(previewImage.extra_json?.elapsed_ms)],
                        ['比例', previewImage.aspect_ratio || '—'],
                        ['分辨率', previewImage.resolution || '—'],
                        ['像素', previewImage.width && previewImage.height ? `${previewImage.width} × ${previewImage.height}` : '—'],
                        ['请求尺寸', previewImage.extra_json?.size || '—'],
                        ['种子', previewImage.extra_json?.seed ?? '—'],
                        ['步数', previewImage.extra_json?.steps ?? '—'],
                        ['张数', previewImage.extra_json?.n ?? previewImage.n_index ?? '—'],
                        ['生成时间', previewImage.created_at ? new Date(previewImage.created_at).toLocaleString() : '—'],
                      ].map(([label, value]) => (
                        <div key={String(label)}>
                          <span className="text-zinc-600">{label}</span>
                          <p className="truncate text-zinc-400" title={String(value)}>{String(value)}</p>
                        </div>
                      ))}
                    </div>

                    {previewImage.parent_image_id && (
                      <div className="mt-3 text-xs text-emerald-400">
                        此图由另一张图片编辑而来
                      </div>
                    )}
                  </div>
                )}
              </footer>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
