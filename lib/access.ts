const COOKIE = 'gs_access';
const SALT = 'grok-studio-access';

export function accessCookieName() {
  return COOKIE;
}

export function accessPassword(): string {
  return (process.env.STUDIO_PASSWORD || process.env.ACCESS_PASSWORD || '').trim();
}

export function accessEnabled(): boolean {
  return accessPassword().length > 0;
}

export async function accessToken(password = accessPassword()): Promise<string> {
  const data = new TextEncoder().encode(`${password}|${SALT}`);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function accessCookieValid(value: string | undefined | null): Promise<boolean> {
  if (!accessEnabled()) return true;
  if (!value) return false;
  const expected = await accessToken();
  if (value.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= value.charCodeAt(i) ^ expected.charCodeAt(i);
  return mismatch === 0;
}
