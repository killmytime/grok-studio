import { NextResponse } from 'next/server';
import { getVendor } from '@/app/lib/vendors';
import { listRemoteModels } from '@/app/lib/providers/list-models';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  let kind = body.kind || 'grok';
  let baseUrl = body.base_url || '';
  let apiKey = body.api_key || '';
  let cookie = typeof body.cookie === 'string' ? body.cookie : '';

  if (body.vendor_id) {
    const vendor = getVendor(body.vendor_id);
    if (!vendor) return NextResponse.json({ error: 'vendor not found' }, { status: 404 });
    kind = vendor.kind;
    baseUrl = baseUrl || vendor.base_url;
    if (!apiKey || apiKey === '********') apiKey = vendor.api_key;
    if (!cookie) cookie = String(vendor.extra?.cookie || '');
  }

  try {
    const result = await listRemoteModels({ kind, baseUrl, apiKey, cookie });
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message, body: e.body }, { status: e.status || 500 });
  }
}
