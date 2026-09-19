import { NextResponse } from 'next/server';
import { accessCookieName } from '@/lib/access';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(accessCookieName(), '', { httpOnly: true, path: '/', maxAge: 0 });
  return res;
}
