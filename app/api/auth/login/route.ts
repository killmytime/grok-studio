import { NextResponse } from 'next/server';
import { accessCookieName, accessEnabled, accessPassword, accessToken } from '@/lib/access';

export async function POST(req: Request) {
  if (!accessEnabled()) {
    return NextResponse.json({ ok: true, required: false });
  }
  const { password } = await req.json().catch(() => ({ password: '' }));
  if (typeof password !== 'string' || password !== accessPassword()) {
    return NextResponse.json({ ok: false, error: '密码错误' }, { status: 401 });
  }
  const token = await accessToken();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(accessCookieName(), token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
