'use client';

import { useState } from 'react';
import { Plus, Trash2, Edit2, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';

interface Conversation {
  id: string;
  title: string;
  last_message_at: string;
}

interface Props {
  conversations: Conversation[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, newTitle: string) => void;
}

export default function ConversationList({ conversations, currentId, onSelect, onNew, onDelete, onRename }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState('');

  const filteredConversations = conversations.filter(c =>
    c.title.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const startRename = (conv: Conversation, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(conv.id);
    setEditValue(conv.title);
  };

  const saveRename = async (id: string) => {
    if (editValue.trim()) {
      await onRename(id, editValue.trim());
    }
    setEditingId(null);
    setEditValue('');
  };

  const cancelRename = () => {
    setEditingId(null);
    setEditValue('');
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete(id);
    toast({ title: '会话已删除', variant: 'default' });
    setDeleting(null);
  };

  return (
    <div className="sidebar w-[260px] flex flex-col h-full border-r border-zinc-800">
      <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
        <div className="font-semibold text-lg tracking-tight">会话</div>
        <Button size="sm" variant="secondary" onClick={onNew} className="h-8 px-3">
          <Plus className="w-4 h-4 mr-1" /> 新建
        </Button>
      </div>

      <div className="p-2 border-b border-zinc-800">
        <input
          type="text"
          placeholder="搜索会话..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-1 text-sm focus:outline-none focus:border-blue-600"
        />
      </div>

      <div className="flex-1 overflow-auto p-2 chat-container">
        {filteredConversations.length === 0 && (
          <div className="text-center text-sm text-zinc-500 py-8">
            {searchTerm ? '无匹配会话' : '暂无会话'}
          </div>
        )}
        {filteredConversations.map((c) => (
          <div
            key={c.id}
            onClick={() => onSelect(c.id)}
            className={`conv-item flex items-center justify-between text-sm mb-1 ${currentId === c.id ? 'active' : ''}`}
          >
            {editingId === c.id ? (
              <div className="flex items-center gap-1 flex-1 pr-1" onClick={e => e.stopPropagation()}>
                <input
                  className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-0.5 text-sm"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveRename(c.id);
                    if (e.key === 'Escape') cancelRename();
                  }}
                  autoFocus
                />
                <button onClick={() => saveRename(c.id)} className="p-1"><Check className="w-3.5 h-3.5" /></button>
                <button onClick={cancelRename} className="p-1"><X className="w-3.5 h-3.5" /></button>
              </div>
            ) : (
              <>
                <div className="truncate pr-2 flex-1">{c.title}</div>
                <div className="flex items-center gap-0.5 opacity-40 hover:opacity-100">
                  <button onClick={(e) => startRename(c, e)} className="p-1">
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={(e) => handleDelete(c.id, e)}
                    disabled={deleting === c.id}
                    className="p-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="p-3 border-t border-zinc-800 text-[10px] text-zinc-500">
        本地持久化 · 刷新不丢
      </div>
    </div>
  );
}
