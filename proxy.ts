import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { accessCookieName, accessCookieValid, accessEnabled } from './lib/access';

export async function proxy(request: NextRequest) {
  if (!accessEnabled()) return NextResponse.next();

  const { pathname } = request.nextUrl;
  const publicPath =
    pathname.startsWith('/login') ||
    pathname.startsWith('/api/auth/') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/__nextjs') ||
    pathname === '/favicon.ico';
  if (publicPath) return NextResponse.next();

  const ok = await accessCookieValid(request.cookies.get(accessCookieName())?.value);
  if (ok) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized', login: '/login' }, { status: 401 });
  }

  const login = new URL('/login', request.url);
  login.searchParams.set('next', pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ['/((?!_next/|__nextjs|favicon.ico).*)'],
};
