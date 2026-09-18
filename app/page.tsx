'use client';

import { useState, useEffect, useRef } from 'react';
import ConversationList from './components/ConversationList';
import MessageItem from './components/MessageItem';
import ImagePanel from './components/ImagePanel';
import ImageCard from './components/ImageCard';
import SettingsDrawer from './components/SettingsDrawer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Send, Image as ImageIcon, Edit3, X, ChevronLeft, ChevronRight, Download, Copy, Menu, Image, MessageCircle } from 'lucide-react';
import type { Conversation, Message, ImageAsset, AppSettings } from './lib/types';
import { useToast } from '@/components/ui/toast';

export default function GrokStudio() {
  const { toast } = useToast();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConvId, setCurrentConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageDisplayLimit, setMessageDisplayLimit] = useState(20);
  const [images, setImages] = useState<ImageAsset[]>([]);
  const [currentImage, setCurrentImage] = useState<ImageAsset | null>(null);
  const [previewImage, setPreviewImage] = useState<ImageAsset | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);

  const [input, setInput] = useState('');
  const [selectedAspect, setSelectedAspect] = useState('1:1');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [settings, setSettings] = useState<AppSettings>({
    base_url: '', api_key: '', chat_model: 'grok-latest', image_model: 'grok-imagine-image-2.0',
    default_aspect_ratio: '1:1', default_resolution: '1k', default_n: '1', edit_compatibility_mode: 'json',
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
  const [showImageDialog, setShowImageDialog] = useState(false);

  const chatContainerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const imageAbortRef = useRef<AbortController | null>(null);

  // Load initial data
  useEffect(() => {
    loadConversations();
    loadSettings();
  }, []);

  useEffect(() => {
    if (currentConvId) {
      loadMessages(currentConvId);
      loadImages(currentConvId);
    } else {
      setMessages([]);
      setImages([]);
      setCurrentImage(null);
    }
  }, [currentConvId]);

  const scrollToBottom = () => {
    setTimeout(() => {
      chatContainerRef.current?.scrollTo({ top: chatContainerRef.current.scrollHeight, behavior: 'smooth' });
    }, 50);
  };

  async function loadConversations() {
    const res = await fetch('/api/conversations');
    const data = await res.json();
    setConversations(data);
    if (data.length > 0 && !currentConvId) {
      setCurrentConvId(data[0].id);
    }
  }

  async function loadMessages(convId: string) {
    const res = await fetch(`/api/conversations/${convId}/messages`);
    const data = await res.json();
    setMessages(data);
    setMessageDisplayLimit(20); // 默认只显示最近20条，避免长对话卡顿
    scrollToBottom();
  }

  async function loadImages(convId: string) {
    const res = await fetch(`/api/conversations/${convId}/images`);
    if (res.ok) {
      const data = await res.json();
      setImages(data);
    } else {
      setImages([]);
    }
  }

  async function loadSettings() {
    const res = await fetch('/api/settings');
    const data = await res.json();
    setSettings(data);
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

  async function sendChatMessage() {
    if (!input.trim() || !currentConvId) return;

    const userContent = input.trim();
    setInput('');

    // 1. 保存用户消息
    await fetch(`/api/conversations/${currentConvId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'user', content: userContent }),
    });

    // 2. 创建 pending 的 assistant 消息
    const pendingRes = await fetch(`/api/conversations/${currentConvId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'assistant', content: '', status: 'pending' }),
    });
    const pendingMsg = await pendingRes.json();

    // 3. 乐观更新
    const userMsg: Message = {
      id: Date.now().toString(),
      conversation_id: currentConvId,
      role: 'user',
      content: userContent,
      created_at: new Date().toISOString(),
      status: 'completed',
    };

    const assistantPlaceholder: Message = {
      ...pendingMsg,
      status: 'pending',
    };

    setMessages(prev => [...prev, userMsg, assistantPlaceholder]);
    scrollToBottom();

    // 4. 调用流式接口
    setIsStreaming(true);
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const history = [...messages, userMsg].map(m => ({ role: m.role, content: m.content }));

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: currentConvId,
          messages: history,
          pendingMessageId: pendingMsg.id,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) throw new Error('Chat failed');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const payload = line.slice(6).trim();
            if (payload === '[DONE]') continue;
            try {
              const json = JSON.parse(payload);
              const delta = json.choices?.[0]?.delta?.content || '';
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
      }

      await loadMessages(currentConvId);
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        toast({
          title: '聊天失败',
          description: e.message,
          variant: 'error',
        });
        await fetch(`/api/conversations/${currentConvId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            role: 'assistant',
            content: '',
            status: 'error',
            error_message: e.message,
          }),
        });
        await loadMessages(currentConvId);
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;

      // 自动命名
      if (currentConvId) {
        const conv = conversations.find(c => c.id === currentConvId);
        if (conv && conv.title === '新会话') {
          setTimeout(async () => {
            try {
              const res = await fetch(`/api/conversations/${currentConvId}/summarize`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  messages: messages.slice(0, 8),
                  prompt: '用 8-12 个字为这个对话取一个简短标题，不要引号，直接输出标题。'
                })
              });
              const data = await res.json();
              if (data.summary) {
                await fetch(`/api/conversations/${currentConvId}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ title: data.summary })
                });
                await loadConversations();
              }
            } catch (_) {}
          }, 800);
        }
      }
    }
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
          resolution: settings.default_resolution || '1k',
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
        // 不再插入聊天消息，避免污染对话历史（图片已在右侧面板显示）
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
          resolution: settings.default_resolution || '1k',
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
    setIsStreaming(false);
    setIsGenerating(false);
  }

  function retryImage(image: ImageAsset) {
    // Simple retry: use its prompt to generate again
    generateImage(image.prompt);
    // Optionally remove the error one, but keep for now
  }

  function buildContextForAPI(msgs: Message[], summary: string | null): any[] {
    const MAX_RECENT = 14;
    const KEEP_PREFIX = 3;

    if (msgs.length <= MAX_RECENT + KEEP_PREFIX) {
      return msgs.map(m => ({ role: m.role, content: m.content }));
    }

    const prefix = msgs.slice(0, KEEP_PREFIX).map(m => ({ role: m.role, content: m.content }));
    const recent = msgs.slice(-MAX_RECENT).map(m => ({ role: m.role, content: m.content }));

    if (summary) {
      return [
        ...prefix,
        { role: 'system', content: `[对话摘要] ${summary}` },
        ...recent
      ];
    }
    return [...prefix, ...recent];
  }

  async function maybeTriggerSummarize(convId: string, currentMessages: Message[]) {
    if (currentMessages.length < 28) return; // 阈值：超过28条才考虑摘要

    // 避免频繁摘要，简单判断
    try {
      const res = await fetch(`/api/conversations/${convId}/summarize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: currentMessages }),
      });
      const data = await res.json();
      if (data.summary) {
        // 这里可以调用 updateConversationSummary，但因为是 client，我们用一个简单 POST
        await fetch(`/api/conversations/${convId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ summary: data.summary }),
        });
      }
    } catch (e) {
      // 摘要失败不影响主流程
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

  async function testConnection(type: 'chat' | 'image') {
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
    if (!currentConvId) return;

    // Update in DB
    await fetch(`/api/conversations/${currentConvId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'user', content: newContent, messageIdToUpdate: messageId }),
    });

    // Optimistic update + re-send
    setMessages(prev => prev.map(m => m.id === messageId ? { ...m, content: newContent } : m));
    setInput(newContent);
    setTimeout(() => {
      sendChatMessage();
    }, 100);
  }

  // Slash command + RP mode support
  const [activeSystemPrompt, setActiveSystemPrompt] = useState<string | null>(null);

  const SLASH_COMMANDS: Record<string, string> = {
    '/rp': '你现在进入角色扮演模式。请用生动、沉浸式的语言回应，保持角色一致性。',
    '/roleplay': '你现在进入角色扮演模式。请用生动、沉浸式的语言回应，保持角色一致性。',
    '/qa': '你是一个严谨的问答助手。只回答用户的问题，不要添加多余的解释或闲聊。',
    '/strict': '请保持极度严谨、客观，只基于已提供的信息回答。',
  };

  function parseSlashCommand(text: string): { command: string | null; cleanText: string; systemPrompt?: string } {
    const trimmed = text.trim();
    if (!trimmed.startsWith('/')) return { command: null, cleanText: text };

    const firstSpace = trimmed.indexOf(' ');
    const cmd = firstSpace === -1 ? trimmed.toLowerCase() : trimmed.slice(0, firstSpace).toLowerCase();
    const rest = firstSpace === -1 ? '' : trimmed.slice(firstSpace + 1);

    if (cmd === '/summary' || cmd === '/summarize') {
      if (currentConvId) maybeTriggerSummarize(currentConvId, messages);
      return { command: cmd, cleanText: '' };
    }

    if (SLASH_COMMANDS[cmd]) {
      return { command: cmd, cleanText: rest, systemPrompt: SLASH_COMMANDS[cmd] };
    }

    return { command: null, cleanText: text };
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
  };

  const changePreview = (direction: number) => {
    if (images.length === 0) return;
    const newIndex = (previewIndex + direction + images.length) % images.length;
    setPreviewIndex(newIndex);
    setPreviewImage(images[newIndex]);
  };

  const handleEditFromPanel = (img: ImageAsset) => {
    toast({ title: '编辑图片', description: '使用原prompt进行修改（提示输入已由toast替代native dialog）', variant: 'default' });
    const editPrompt = img.prompt || '基于原图修改';
    if (editPrompt) {
      editImage(img, editPrompt);
    }
  };

  async function retryMessage(messageId: string) {
    if (!currentConvId) return;

    const msgIndex = messages.findIndex(m => m.id === messageId);
    if (msgIndex === -1) return;

    const targetMsg = messages[msgIndex];

    // 先删除这条消息
    await fetch(`/api/conversations/${currentConvId}/messages`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId }),
    });
    setMessages(prev => prev.filter(m => m.id !== messageId));

    if (targetMsg.role === 'assistant') {
      // 重试 assistant 消息 → 重新发送上一条 user 消息
      const prevUser = [...messages].slice(0, msgIndex).reverse().find(m => m.role === 'user');
      if (prevUser) {
        setInput(prevUser.content);
        setTimeout(() => sendChatMessage(), 80);
      }
    } else {
      // 重试 user 消息
      setInput(targetMsg.content);
      setTimeout(() => sendChatMessage(), 80);
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-zinc-950 text-zinc-200">
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
        <div className="h-14 border-b border-zinc-800 flex items-center justify-between px-4">
          <div className="flex items-center gap-2">
            {/* Mobile: Open Conversations Dialog */}
            <Button 
              variant="ghost" 
              size="icon" 
              className="md:hidden h-9 w-9" 
              onClick={() => setShowConvDialog(true)}
            >
              <Menu className="w-5 h-5" />
            </Button>
            {/* Desktop: Toggle left sidebar */}
            <Button 
              variant="ghost" 
              size="icon" 
              className="hidden md:flex h-9 w-9" 
              onClick={() => setLeftSidebarOpen(!leftSidebarOpen)}
            >
              {leftSidebarOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </Button>

            <div className="font-medium tracking-tight">Grok Studio</div>
          </div>

          <div className="flex items-center gap-2 text-sm text-zinc-400">
            {currentConvId && <span className="hidden sm:inline">当前会话 #{currentConvId.slice(0, 8)}</span>}
            {currentConvId && messages.length > 20 && (
              <Button 
                variant="ghost" 
                size="sm" 
                className="h-9 px-3 text-xs md:h-7 md:px-2 md:text-xs text-zinc-400 hover:text-zinc-200 active:bg-zinc-800"
                onClick={() => maybeTriggerSummarize(currentConvId, messages)}
              >
                手动摘要
              </Button>
            )}
            {currentConvId && (() => {
              const conv = conversations.find(c => c.id === currentConvId);
              return conv?.summary ? (
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-9 px-3 text-xs md:h-7 md:px-2 md:text-xs text-amber-400 hover:text-amber-300"
                  onClick={() => toast({ title: '当前记忆摘要', description: conv.summary, variant: 'default' })}
                >
                  查看记忆
                </Button>
              ) : null;
            })()}
            <SettingsDrawer settings={settings} onSave={saveSettings} onTest={testConnection} />
            
            {/* Mobile: Open Images Dialog */}
            <Button 
              variant="ghost" 
              size="icon" 
              className="md:hidden h-9 w-9" 
              onClick={() => setShowImageDialog(true)}
            >
              <Image className="w-5 h-5" />
            </Button>
            {/* Desktop: Toggle right sidebar */}
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
            className={`flex-1 overflow-auto p-6 chat-container bg-zinc-950 ${mobileTab === 'images' ? 'hidden md:block' : 'block'}`}
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
              />
            ))}
            {isStreaming && <div className="text-xs text-zinc-500 pl-4">正在生成回复...</div>}
          </div>

          {/* Mobile Images View: show image panel content when tab=images */}
          {mobileTab === 'images' && (
            <div className="flex-1 overflow-auto md:hidden border-t border-zinc-800">
              <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
                <div className="font-semibold">图片资产 ({images.length})</div>
                <Button size="sm" variant="ghost" onClick={() => setMobileTab('chat')}>返回聊天</Button>
              </div>
              <div className="p-3">
                {images.length === 0 && (
                  <div className="text-center text-sm text-zinc-500 py-12">本会话暂无图片<br />发送「生成图片」或上传开始</div>
                )}
                {images.map(img => (
                  <div key={img.id} onClick={() => { handleSelectImage(img); setMobileTab('chat'); }} className={currentImage?.id === img.id ? 'ring-1 ring-blue-500 rounded-lg' : ''}>
                    <ImageCard 
                      image={img} 
                      onEdit={handleEditFromPanel}
                      onSetCurrent={handleSelectImage}
                      onPreview={handlePreview}
                      onRetry={retryImage}
                      compact={true}
                    />
                  </div>
                ))}
              </div>
              {currentImage && (
                <div className="border-t border-zinc-800 p-4 text-xs bg-zinc-950 sticky bottom-0">
                  <div>当前选中: {currentImage.prompt.slice(0,50)}...</div>
                  <Button className="w-full mt-2" onClick={() => { handleEditFromPanel(currentImage); setMobileTab('chat'); }}>继续编辑</Button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Bottom Tab Bar - Mobile only */}
        <div className="md:hidden border-t border-zinc-800 bg-zinc-950 flex">
          <button
            onClick={() => setMobileTab('chat')}
            className={`flex-1 flex flex-col items-center py-2 text-xs ${mobileTab === 'chat' ? 'text-white bg-zinc-900' : 'text-zinc-400'}`}
          >
            <MessageCircle className="w-5 h-5 mb-0.5" /> 聊天
          </button>
          <button
            onClick={() => setMobileTab('images')}
            className={`flex-1 flex flex-col items-center py-2 text-xs ${mobileTab === 'images' ? 'text-white bg-zinc-900' : 'text-zinc-400'}`}
          >
            <Image className="w-5 h-5 mb-0.5" /> 图片
          </button>
        </div>

        <div className="border-t border-zinc-800 p-4 bg-zinc-950">
          {/* 比例快速选择器 */}
          <div className="flex items-center gap-2 mb-2 px-1">
            <div className="text-xs text-zinc-500 mr-1">比例：</div>
            {['1:1', '16:9', '9:16', '4:3', '3:4'].map(ratio => (
              <button
                key={ratio}
                onClick={() => setSelectedAspect(ratio)}
                className={`px-3 py-0.5 text-xs rounded-full border transition ${
                  selectedAspect === ratio 
                    ? 'bg-blue-600 border-blue-600 text-white' 
                    : 'border-zinc-700 hover:bg-zinc-800 text-zinc-400'
                }`}
              >
                {ratio}
              </button>
            ))}
            <div className="text-[10px] text-zinc-500 ml-2">· 默认 1k（节省额度）</div>
          </div>

          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Textarea
                className="chat-input min-h-[48px] max-h-[120px] text-base pl-4 pr-24 resize-y"
                placeholder={currentImage ? `继续改这张图... (Shift+Enter 换行)` : "输入消息或图片描述 (Shift+Enter 换行)"}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (currentImage) {
                      editImage(currentImage, input.trim());
                    } else {
                      sendChatMessage();
                    }
                  }
                }}
                disabled={isStreaming || isGenerating || !currentConvId}
              />
              <div className="absolute right-2 bottom-2 flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 px-3 text-xs"
                  onClick={() => generateImage()}
                  disabled={!input.trim() || isGenerating || !currentConvId}
                >
                  <ImageIcon className="w-4 h-4 mr-1" /> 生成图片
                </Button>
                {currentImage && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 px-3 text-xs"
                    onClick={() => editImage(currentImage, input.trim() || '继续优化')}
                    disabled={isGenerating || !currentConvId}
                  >
                    <Edit3 className="w-4 h-4 mr-1" /> 改图
                  </Button>
                )}
              </div>
            </div>
            {(isStreaming || isGenerating) ? (
              <Button 
                className="h-12 px-6" 
                variant="destructive"
                onClick={stopGeneration}
              >
                中断
              </Button>
            ) : (
              <Button 
                className="h-12 px-6" 
                onClick={() => currentImage ? editImage(currentImage, input.trim()) : sendChatMessage()}
                disabled={(!input.trim() && !currentImage) || isStreaming || isGenerating || !currentConvId}
              >
                <Send className="w-4 h-4" />
              </Button>
            )}
          </div>
          <div className="text-[10px] text-zinc-500 mt-1.5 px-1">
            Enter 发送 · Shift+Enter 换行 · 选中图片后可继续编辑
          </div>
        </div>
      </div>

      {/* Right Sidebar: Images - Desktop collapsible, Mobile via Dialog + Tab */}
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

      <Dialog open={showImageDialog} onOpenChange={setShowImageDialog}>
        <DialogContent className="max-w-[95vw] p-0 bg-zinc-950 border-zinc-800 h-[85vh]">
          <DialogHeader className="p-4 border-b border-zinc-800">
            <DialogTitle>图片资产</DialogTitle>
          </DialogHeader>
          <div className="overflow-auto flex-1 p-3">
            <ImagePanel
              images={images}
              currentImage={currentImage}
              onSelectImage={(img) => { handleSelectImage(img); setShowImageDialog(false); setMobileTab('chat'); }}
              onEditImage={handleEditFromPanel}
              onUpload={handleUpload}
              onPreview={handlePreview}
              conversationId={currentConvId}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* 大图预览 Dialog */}
      <Dialog open={!!previewImage} onOpenChange={(open) => !open && closePreview()}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] p-0 bg-zinc-950 border-zinc-800">
          {previewImage && (
            <div className="flex flex-col h-[90vh]">
              {/* 顶部工具栏 */}
              <div className="flex items-center justify-between p-4 border-b border-zinc-800">
                <div className="text-sm text-zinc-400">
                  {previewIndex + 1} / {images.length}
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => changePreview(-1)} disabled={images.length <= 1}>
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => changePreview(1)} disabled={images.length <= 1}>
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => {
                    const fullUrl = `/api/files/${previewImage.file_path}`;
                    const a = document.createElement('a');
                    a.href = fullUrl;
                    a.download = `${previewImage.prompt.slice(0,30)}.png`;
                    a.click();
                  }}>
                    <Download className="w-4 h-4 mr-1" /> 下载
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => navigator.clipboard.writeText(previewImage.prompt)}>
                    <Copy className="w-4 h-4 mr-1" /> 复制 Prompt
                  </Button>
                  <Button variant="ghost" size="icon" onClick={closePreview}>
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {/* 大图区域 */}
              <div className="flex-1 flex items-center justify-center bg-black p-4 overflow-auto">
                <img 
                  src={`/api/files/${previewImage.file_path}`} 
                  alt={previewImage.prompt}
                  className="max-w-full max-h-full object-contain"
                />
              </div>

              {/* 底部信息 */}
              <div className="p-4 border-t border-zinc-800 bg-zinc-950 text-sm">
                <div className="line-clamp-3 text-zinc-300 mb-3">{previewImage.prompt}</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1 text-xs text-zinc-500">
                  <div>模型：{previewImage.model}</div>
                  <div>比例：{previewImage.aspect_ratio}</div>
                  <div>分辨率：{previewImage.resolution}</div>
                  <div>尺寸：{previewImage.width} × {previewImage.height}</div>
                  <div>类型：{previewImage.kind}</div>
                  <div>时间：{new Date(previewImage.created_at).toLocaleString()}</div>
                </div>
                {previewImage.parent_image_id && (
                  <div className="mt-2 text-emerald-400 text-xs">此图由另一张图片编辑而来</div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
