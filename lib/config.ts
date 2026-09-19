/**
 * Next.js matches allowedDevOrigins as DNS labels:
 *   *  = exactly one label
 *   ** = one or more labels (only at the start)
 * A lone "*" or "**" is rejected and matches nothing.
 * IPs must be listed, or use *.*.*.* for any IPv4.
 */
const PERMISSIVE_DEV_ORIGINS = [
  '**.heiyu.space',
  '*.heiyu.space',
  'heiyu.space',
  '**.local',
  '*.local',
  '*.*.*.*',
];

function parseList(envValue: string): string[] {
  return envValue.split(',').map((o) => o.trim()).filter(Boolean);
}

export function getAllowedDevOrigins(): string[] {
  const envValue = process.env.ALLOWED_DEV_ORIGINS;
  if (envValue) {
    const parts = parseList(envValue);
    if (parts.includes('*') || parts.includes('**')) {
      return [...new Set([...parts.filter((p) => p !== '*' && p !== '**'), ...PERMISSIVE_DEV_ORIGINS])];
    }
    return parts;
  }
  return PERMISSIVE_DEV_ORIGINS;
}
