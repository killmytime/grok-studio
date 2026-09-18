'use client';

import { Message } from '@/app/lib/types';
import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';

interface Props {
  message: Message & { status?: string; error_message?: string | null };
  onRetry?: (messageId: string) => void;
  onDelete?: (messageId: string) => void;
  onEdit?: (messageId: string, newContent: string) => void;
}

export default function MessageItem({ message, onRetry, onDelete, onEdit }: Props) {
  const isUser = message.role === 'user';
  const isError = message.status === 'error';
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(message.content);
  const [isActive, setIsActive] = useState(false); // 移动端点击显示操作按钮
  const { toast } = useToast();

  const handleSaveEdit = () => {
    if (onEdit && editValue.trim() && editValue.trim() !== message.content) {
      onEdit(message.id, editValue.trim());
    }
    setIsEditing(false);
  };

  const cancelEdit = () => {
    setEditValue(message.content);
    setIsEditing(false);
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
    } catch (e) {
      const textarea = document.createElement('textarea');
      textarea.value = message.content;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
  };

  // 移动端点击切换操作按钮显示
  const toggleActions = () => {
    if (window.innerWidth < 768) {
      setIsActive(!isActive);
    }
  };

  if (isError) {
    return (
      <div className="flex justify-start mb-4">
        <div className="max-w-[80%] rounded-lg bg-red-950 border border-red-800 p-3 text-sm">
          <div className="text-red-400 font-medium mb-1">发送失败</div>
          <div className="text-zinc-400 text-xs mb-2">
            {message.error_message || '未知错误'}
          </div>
          <div className="flex gap-2">
            {onRetry && (
              <button
                onClick={() => onRetry(message.id)}
                className="text-xs px-2 py-0.5 bg-red-900 hover:bg-red-800 rounded"
              >
                重试
              </button>
            )}
            {onDelete && (
              <button
                onClick={() => {
                  onDelete(message.id);
                  toast({ title: '消息已删除', variant: 'default' });
                }}
                className="text-xs px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 rounded"
              >
                删除
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div 
      className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4 group`}
      onClick={toggleActions}
    >
      <div className={`message-bubble ${isUser ? 'message-user' : 'message-assistant'} relative max-w-[80%] ${isActive ? 'active' : ''}`}>
        {isEditing ? (
          <div className="flex flex-col gap-2">
            <Textarea
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className="min-h-[60px] text-sm"
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="ghost" onClick={cancelEdit}>取消</Button>
              <Button size="sm" onClick={handleSaveEdit}>保存并重新发送</Button>
            </div>
          </div>
        ) : (
          <>
            <div className="prose prose-invert prose-sm max-w-none break-words">
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[rehypeHighlight, rehypeKatex]}
                components={{
                  code({ node, className, children, ...props }) {
                    const match = /language-(\w+)/.exec(className || '');
                    return match ? (
                      <pre className={className}>
                        <code {...props}>{children}</code>
                      </pre>
                    ) : (
                      <code className="px-1 py-0.5 bg-zinc-800 rounded text-sm" {...props}>
                        {children}
                      </code>
                    );
                  },
                }}
              >
                {message.content || ''}
              </ReactMarkdown>
            </div>

            {message.extra_json?.model && (
              <div className="text-[10px] opacity-60 mt-1">{message.extra_json.model}</div>
            )}
            {message.status === 'pending' && (
              <div className="text-[10px] opacity-60 mt-1">正在生成...</div>
            )}
          </>
        )}

        {/* 操作按钮组 */}
        {!isEditing && (
          <div className="message-actions absolute -top-1 right-2 flex gap-1 transition">
            <button
              onClick={(e) => { e.stopPropagation(); copyToClipboard(); }}
              className="text-[10px] px-1.5 py-0.5 bg-zinc-800 hover:bg-zinc-700 rounded flex items-center gap-0.5"
              title="复制消息"
            >
              <Copy className="w-3 h-3" /> 复制
            </button>
            {isUser && onEdit && (
              <button
                onClick={(e) => { e.stopPropagation(); setIsEditing(true); }}
                className="text-[10px] px-1.5 py-0.5 bg-zinc-800 hover:bg-zinc-700 rounded"
              >
                编辑
              </button>
            )}
            {onDelete && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(message.id);
                  toast({ title: '消息已删除', variant: 'default' });
                }}
                className="text-[10px] px-1.5 py-0.5 bg-zinc-800 hover:bg-red-900 rounded"
              >
                删除
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
