import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { accessCookieName, accessCookieValid, accessEnabled } from '@/lib/access';

export async function GET() {
  const required = accessEnabled();
  if (!required) return NextResponse.json({ required: false, ok: true });
  const jar = await cookies();
  const ok = await accessCookieValid(jar.get(accessCookieName())?.value);
  return NextResponse.json({ required: true, ok });
}
