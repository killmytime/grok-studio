'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
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

        <div className="space-y-4 py-4">
          <div>
            <div className="text-xs text-zinc-400 mb-1.5">GROK_BASE_URL（中转地址）</div>
            <Input 
              className="settings-input" 
              value={form.base_url} 
              onChange={e => setForm({ ...form, base_url: e.target.value })} 
              placeholder="http://127.0.0.1:3000/v1" 
            />
          </div>

          <div>
            <div className="text-xs text-zinc-400 mb-1.5">GROK_API_KEY</div>
            <Input 
              className="settings-input" 
              type="password" 
              value={form.api_key} 
              onChange={e => setForm({ ...form, api_key: e.target.value })} 
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs text-zinc-400 mb-1.5">聊天模型</div>
              <Input className="settings-input" value={form.chat_model} onChange={e => setForm({ ...form, chat_model: e.target.value })} />
            </div>
            <div>
              <div className="text-xs text-zinc-400 mb-1.5">绘图模型</div>
              <Input className="settings-input" value={form.image_model} onChange={e => setForm({ ...form, image_model: e.target.value })} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="text-xs text-zinc-400 mb-1.5">默认比例</div>
              <Input className="settings-input" value={form.default_aspect_ratio} onChange={e => setForm({ ...form, default_aspect_ratio: e.target.value })} />
            </div>
            <div>
              <div className="text-xs text-zinc-400 mb-1.5">默认分辨率</div>
              <Input className="settings-input" value={form.default_resolution} onChange={e => setForm({ ...form, default_resolution: e.target.value })} />
            </div>
            <div>
              <div className="text-xs text-zinc-400 mb-1.5">默认 n</div>
              <Input className="settings-input" value={form.default_n} onChange={e => setForm({ ...form, default_n: e.target.value })} />
            </div>
          </div>

          <div>
            <div className="text-xs text-zinc-400 mb-1.5">改图兼容模式</div>
            <select 
              className="settings-input w-full h-9 rounded-md px-3 text-sm"
              value={form.edit_compatibility_mode}
              onChange={e => setForm({ ...form, edit_compatibility_mode: e.target.value })}
            >
              <option value="json">官方 JSON /images/edits</option>
              <option value="generations">回退到 generations（中转支持时）</option>
              <option value="error">仅报错（严格）</option>
            </select>
          </div>

          <div className="flex gap-2 pt-2">
            <Button onClick={() => test('chat')} disabled={!!testing} variant="outline" size="sm">测试聊天</Button>
            <Button onClick={() => test('image')} disabled={!!testing} variant="outline" size="sm">测试绘图</Button>
            <Button onClick={handleSave} className="ml-auto">保存设置</Button>
          </div>

          {testResult && (
            <div className="text-xs bg-zinc-900 p-3 rounded border border-zinc-800 font-mono">
              {JSON.stringify(testResult, null, 2).slice(0, 600)}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
