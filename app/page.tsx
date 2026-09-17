'use client';

import { useState, useEffect, useRef } from 'react';
import ConversationList from './components/ConversationList';
import MessageItem from './components/MessageItem';
import ImagePanel from './components/ImagePanel';
import SettingsDrawer from './components/SettingsDrawer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Send, Image as ImageIcon, Edit3 } from 'lucide-react';
import type { Conversation, Message, ImageAsset, AppSettings } from './lib/types';

export default function GrokStudio() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConvId, setCurrentConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [images, setImages] = useState<ImageAsset[]>([]);
  const [currentImage, setCurrentImage] = useState<ImageAsset | null>(null);

  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [settings, setSettings] = useState<AppSettings>({
    base_url: '', api_key: '', chat_model: 'grok-latest', image_model: 'grok-imagine-image-2.0',
    default_aspect_ratio: '1:1', default_resolution: '1k', default_n: '1', edit_compatibility_mode: 'json'
  });

  const chatContainerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

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

    const userMsg: Message = {
      id: Date.now().toString(),
      conversation_id: currentConvId,
      role: 'user',
      content: input.trim(),
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    scrollToBottom();

    await fetch(`/api/conversations/${currentConvId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'user', content: userMsg.content }),
    });

    setIsStreaming(true);
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const history = [...messages, userMsg].map(m => ({ role: m.role, content: m.content }));
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: currentConvId, messages: history }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) throw new Error('Chat failed');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = '';
      let assistantMsgId = 'stream-' + Date.now();

      const placeholder: Message = {
        id: assistantMsgId, conversation_id: currentConvId, role: 'assistant', content: '', created_at: new Date().toISOString()
      };
      setMessages(prev => [...prev, placeholder]);

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
                setMessages(prev => prev.map(m => 
                  m.id === assistantMsgId ? { ...m, content: assistantText } : m
                ));
                scrollToBottom();
              }
            } catch {}
          }
        }
      }

      await loadMessages(currentConvId);
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        alert('聊天失败: ' + e.message);
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  }

  async function generateImage(promptOverride?: string) {
    if (!currentConvId) return;
    const prompt = promptOverride || input.trim();
    if (!prompt) return;

    setIsGenerating(true);

    try {
      const res = await fetch('/api/images/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          conversation_id: currentConvId,
          aspect_ratio: settings.default_aspect_ratio,
          resolution: settings.default_resolution,
          n: settings.default_n,
        }),
      });
      const data = await res.json();
      if (data.error) {
        const msg = data.error.includes('policy') || data.error.includes('content') 
          ? '生成失败：提示词可能违反内容政策，请换个说法' 
          : data.error.includes('rate') || data.error.includes('429')
          ? '生成失败：请求太频繁，请稍后再试'
          : '生成失败：' + (data.body?.error?.message || data.error);
        alert(msg);
        return;
      }

      if (data.images) {
        setImages(prev => [...data.images, ...prev]);
        const genMsg: Message = {
          id: 'gen-' + Date.now(),
          conversation_id: currentConvId,
          role: 'assistant',
          content: `已生成 ${data.images.length} 张图片`,
          created_at: new Date().toISOString(),
          extra_json: { images: data.images.map((i: any) => i.id) }
        };
        setMessages(prev => [...prev, genMsg]);
      }
      scrollToBottom();
    } catch (e: any) {
      alert('生成失败: ' + e.message);
    } finally {
      setIsGenerating(false);
    }
  }

  async function editImage(source: ImageAsset, editPrompt: string) {
    if (!currentConvId) return;
    setIsGenerating(true);

    try {
      const res = await fetch('/api/images/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: editPrompt,
          image_id: source.id,
          conversation_id: currentConvId,
          aspect_ratio: settings.default_aspect_ratio,
          resolution: settings.default_resolution,
        }),
      });
      const data = await res.json();
      if (data.error) {
        const msg = data.error.includes('policy') || data.error.includes('content') 
          ? '改图失败：提示词可能违反内容政策' 
          : data.error.includes('rate') || data.error.includes('429')
          ? '改图失败：请求太频繁，请稍后再试'
          : '改图失败：' + (data.body?.error?.message || data.error);
        alert(msg);
        return;
      }

      if (data.images) {
        setImages(prev => [...data.images, ...prev]);
        setCurrentImage(data.images[0] || null);
      }
    } catch (e: any) {
      alert('改图失败: ' + e.message);
    } finally {
      setIsGenerating(false);
    }
  }

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

  const handleSelectImage = (img: ImageAsset | null) => {
    setCurrentImage(img);
  };

  const handleEditFromPanel = (img: ImageAsset) => {
    const editPrompt = prompt('输入修改说明（例如：把背景换成雨夜东京）:');
    if (editPrompt) {
      editImage(img, editPrompt);
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-zinc-950 text-zinc-200">
      <ConversationList
        conversations={conversations}
        currentId={currentConvId}
        onSelect={setCurrentConvId}
        onNew={createNewConversation}
        onDelete={deleteConversation}
        onRename={renameConversation}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <div className="h-14 border-b border-zinc-800 flex items-center justify-between px-4">
          <div className="font-medium tracking-tight">Grok Studio</div>
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            {currentConvId && <span>当前会话 #{currentConvId.slice(0, 8)}</span>}
            <SettingsDrawer settings={settings} onSave={saveSettings} onTest={testConnection} />
          </div>
        </div>

        <div ref={chatContainerRef} className="flex-1 overflow-auto p-6 chat-container bg-zinc-950">
          {!currentConvId && (
            <div className="h-full flex items-center justify-center text-zinc-500">选择或新建一个会话开始</div>
          )}
          {currentConvId && messages.length === 0 && (
            <div className="text-center text-zinc-500 mt-12">开始聊天或点击「生成图片」</div>
          )}
          {messages.map((m, idx) => (
            <MessageItem key={idx} message={m} />
          ))}
          {isStreaming && <div className="text-xs text-zinc-500 pl-4">正在生成回复...</div>}
        </div>

        <div className="border-t border-zinc-800 p-4 bg-zinc-950">
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Input
                className="chat-input h-12 text-base pl-4 pr-24"
                placeholder={currentImage ? `继续改这张图...` : "输入消息或图片描述"}
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
                disabled={isStreaming || !currentConvId}
              />
              <div className="absolute right-2 top-2 flex gap-1">
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
            <Button 
              className="h-12 px-6" 
              onClick={() => currentImage ? editImage(currentImage, input.trim()) : sendChatMessage()}
              disabled={(!input.trim() && !currentImage) || isStreaming || isGenerating || !currentConvId}
            >
              {isGenerating || isStreaming ? '处理中...' : <Send className="w-4 h-4" />}
            </Button>
          </div>
          <div className="text-[10px] text-zinc-500 mt-1.5 px-1">
            普通 Enter 发送聊天 · 生成图片按钮走绘图模型 · 选中图片后可继续编辑
          </div>
        </div>
      </div>

      <ImagePanel
        images={images}
        currentImage={currentImage}
        onSelectImage={handleSelectImage}
        onEditImage={handleEditFromPanel}
        onUpload={handleUpload}
        conversationId={currentConvId}
      />
    </div>
  );
}
