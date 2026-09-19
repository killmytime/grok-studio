import { NextResponse } from 'next/server';
import { hasCapability, type Capability } from '@/app/lib/integrations/catalog';
import { getVendor, listBindings, setBinding } from '@/app/lib/vendors';

const CAPS: Capability[] = ['chat', 'image.generate', 'image.edit'];

export async function GET() {
  return NextResponse.json({ bindings: listBindings() });
}

export async function POST(req: Request) {
  const body = await req.json();
  const capability = body.capability as Capability;
  if (!CAPS.includes(capability)) {
    return NextResponse.json({ error: 'unknown capability' }, { status: 400 });
  }
  const vendor = getVendor(body.vendor_id);
  if (!vendor) return NextResponse.json({ error: 'vendor not found' }, { status: 404 });
  if (!hasCapability(vendor.kind, capability)) {
    return NextResponse.json({ error: `${vendor.label} 不支持 ${capability}` }, { status: 400 });
  }
  const model = String(body.model || '');
  const allowed = vendor.models.some((m) => m.model === model && m.capabilities.includes(capability));
  if (model && vendor.models.length && !allowed) {
    return NextResponse.json({ error: '该模型未声明此能力' }, { status: 400 });
  }
  const binding = setBinding(capability, vendor.id, model);
  return NextResponse.json({ binding });
}
