'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Settings } from 'lucide-react';

interface SettingsData {
  base_url: string;
  api_key: string;
  chat_model: string;
  image_model: string;
  default_aspect_ratio: string;
  default_resolution: string;
  default_n: string;
  edit_compatibility_mode: string;
  summary_prompt?: string;
  custom_system_prompt?: string;
  temperature?: string;
  max_tokens?: string;
}

interface Props {
  settings: SettingsData;
  onSave: (s: Partial<SettingsData>) => Promise<void>;
  onTest: (type: 'chat' | 'image') => Promise<any>;
}

export default function SettingsDrawer({ settings, onSave, onTest }: Props) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(settings);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<any>(null);

  useEffect(() => {
    setForm(settings);
  }, [settings]);

  const handleSave = async () => {
    await onSave(form);
    setOpen(false);
  };

  const test = async (type: 'chat' | 'image') => {
    setTesting(type);
    setTestResult(null);
    const res = await onTest(type);
    setTestResult(res);
    setTesting(null);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setOpen(true)}>
        <Settings className="w-4 h-4" />
      </Button>
      <DialogContent className="sm:max-w-[520px] bg-zinc-950 border-zinc-800">
        <DialogHeader>
          <DialogTitle>设置 · API 配置</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-zinc-400">Base URL</label>
              <Input value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} className="settings-input mt-1" />
            </div>
            <div>
              <label className="text-xs text-zinc-400">API Key</label>
              <Input value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} className="settings-input mt-1" type="password" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-zinc-400">Chat Model</label>
              <Input value={form.chat_model} onChange={(e) => setForm({ ...form, chat_model: e.target.value })} className="settings-input mt-1" />
            </div>
            <div>
              <label className="text-xs text-zinc-400">Image Model</label>
              <Input value={form.image_model} onChange={(e) => setForm({ ...form, image_model: e.target.value })} className="settings-input mt-1" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-zinc-400">Temperature</label>
              <Input value={form.temperature || '0.7'} onChange={(e) => setForm({ ...form, temperature: e.target.value })} className="settings-input mt-1" placeholder="0.7" />
            </div>
            <div>
              <label className="text-xs text-zinc-400">Max Tokens</label>
              <Input value={form.max_tokens || '4096'} onChange={(e) => setForm({ ...form, max_tokens: e.target.value })} className="settings-input mt-1" placeholder="4096" />
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button onClick={handleSave} className="flex-1">保存设置</Button>
            <Button variant="outline" onClick={() => test('chat')} disabled={!!testing}>测试 Chat</Button>
            <Button variant="outline" onClick={() => test('image')} disabled={!!testing}>测试 Image</Button>
          </div>

          {testResult && (
            <div className="text-xs p-2 bg-zinc-900 rounded">
              {testResult.ok ? '连接成功' : '连接失败'}: {JSON.stringify(testResult).slice(0, 200)}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
