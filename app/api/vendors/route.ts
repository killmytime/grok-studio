import { NextResponse } from 'next/server';
import { INTEGRATIONS, getIntegration, type Capability } from '@/app/lib/integrations/catalog';
import {
  defaultModelsForKind,
  deleteVendor,
  ensureDefaultVendor,
  listVendors,
  upsertVendor,
} from '@/app/lib/vendors';

export async function GET() {
  const vendors = listVendors();
  if (vendors.length === 0) ensureDefaultVendor();
  return NextResponse.json({
    kinds: INTEGRATIONS,
    vendors: listVendors().map((v) => ({ ...v, api_key: v.api_key ? '********' : '' })),
  });
}

export async function POST(req: Request) {
  const body = await req.json();
  const kind = getIntegration(body.kind).id;
  const integration = getIntegration(kind);
  const vendor = upsertVendor({
    kind,
    label: body.label || integration.label,
    base_url: body.base_url || '',
    api_key: body.api_key || '',
    extra: body.extra || {},
    models: Array.isArray(body.models) && body.models.length
      ? body.models
      : defaultModelsForKind(kind),
  });
  return NextResponse.json({ vendor });
}

export async function PUT(req: Request) {
  const body = await req.json();
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const existing = listVendors().find((v) => v.id === body.id);
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const vendor = upsertVendor({
    id: body.id,
    kind: body.kind || existing.kind,
    label: body.label ?? existing.label,
    base_url: body.base_url ?? existing.base_url,
    api_key: body.api_key === '********' ? existing.api_key : (body.api_key ?? existing.api_key),
    extra: body.extra ?? existing.extra,
    models: body.models ?? existing.models.map((m) => ({
      model: m.model,
      capabilities: m.capabilities as Capability[],
      extra: m.extra || undefined,
    })),
  });
  return NextResponse.json({ vendor });
}

export async function DELETE(req: Request) {
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  if (id === 'grok') return NextResponse.json({ error: '不能删除 Grok 基本盘' }, { status: 400 });
  const ok = deleteVendor(id);
  if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
