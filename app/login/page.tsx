'use client';

import { FormEvent, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Suspense } from 'react';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || '登录失败');
        return;
      }
      router.replace(params.get('next') || '/');
    } catch (err: any) {
      setError(err.message || '网络错误');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4 rounded-xl border border-zinc-800 bg-zinc-950 p-6">
      <div>
        <div className="text-lg font-medium">Grok Studio</div>
        <div className="text-xs text-zinc-500 mt-1">IPv4 / IPv6 / 局域网同一道门，输入访问密码</div>
      </div>
      <Input
        type="password"
        autoFocus
        placeholder="访问密码"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="settings-input"
      />
      {error ? <div className="text-xs text-red-400">{error}</div> : null}
      <Button type="submit" className="w-full" disabled={busy || !password}>
        {busy ? '…' : '进入'}
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 p-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
