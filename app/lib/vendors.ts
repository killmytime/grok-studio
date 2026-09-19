import { getDb, getSetting } from './db';
import { getIntegration, type Capability } from './integrations/catalog';

export interface VendorModel {
  id: string;
  vendor_id: string;
  model: string;
  capabilities: Capability[];
  extra?: Record<string, unknown> | null;
}

export interface Vendor {
  id: string;
  kind: string;
  label: string;
  base_url: string;
  api_key: string;
  extra: Record<string, unknown>;
  models: VendorModel[];
  created_at: string;
  updated_at: string;
}

export interface CapabilityBinding {
  capability: Capability;
  vendor_id: string;
  model: string;
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function mapVendor(row: any, models: VendorModel[]): Vendor {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    base_url: row.base_url || '',
    api_key: row.api_key || '',
    extra: parseJson(row.extra_json, {}),
    models,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function listVendorModels(vendorId: string): VendorModel[] {
  const db = getDb();
  const rows = db.prepare(`SELECT * FROM vendor_models WHERE vendor_id = ? ORDER BY model`).all(vendorId) as any[];
  return rows.map((r) => ({
    id: r.id,
    vendor_id: r.vendor_id,
    model: r.model,
    capabilities: parseJson<Capability[]>(r.capabilities, []),
    extra: parseJson(r.extra_json, null),
  }));
}

export function listVendors(): Vendor[] {
  const db = getDb();
  const rows = db.prepare(`SELECT * FROM vendors ORDER BY created_at ASC`).all() as any[];
  return rows.map((r) => mapVendor(r, listVendorModels(r.id)));
}

export function getVendor(id: string): Vendor | undefined {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM vendors WHERE id = ?`).get(id) as any;
  if (!row) return undefined;
  return mapVendor(row, listVendorModels(id));
}

export function upsertVendor(input: {
  id?: string;
  kind: string;
  label: string;
  base_url?: string;
  api_key?: string;
  extra?: Record<string, unknown>;
  models?: Array<{ model: string; capabilities: Capability[]; extra?: Record<string, unknown> }>;
}): Vendor {
  const db = getDb();
  const kind = getIntegration(input.kind).id;
  const id = input.id || (kind === 'grok' ? 'grok' : crypto.randomUUID());
  const ts = nowIso();
  const existing = db.prepare(`SELECT id FROM vendors WHERE id = ?`).get(id) as any;
  if (existing) {
    db.prepare(`
      UPDATE vendors SET kind = ?, label = ?, base_url = ?, api_key = ?, extra_json = ?, updated_at = ?
      WHERE id = ?
    `).run(kind, input.label, input.base_url || '', input.api_key || '', JSON.stringify(input.extra || {}), ts, id);
  } else {
    db.prepare(`
      INSERT INTO vendors (id, kind, label, base_url, api_key, extra_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, kind, input.label, input.base_url || '', input.api_key || '', JSON.stringify(input.extra || {}), ts, ts);
  }

  if (input.models) {
    db.prepare(`DELETE FROM vendor_models WHERE vendor_id = ?`).run(id);
    const ins = db.prepare(`
      INSERT INTO vendor_models (id, vendor_id, model, capabilities, extra_json)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const m of input.models) {
      ins.run(crypto.randomUUID(), id, m.model, JSON.stringify(m.capabilities), m.extra ? JSON.stringify(m.extra) : null);
    }
  }

  return getVendor(id)!;
}

export function deleteVendor(id: string): boolean {
  const db = getDb();
  db.prepare(`DELETE FROM capability_bindings WHERE vendor_id = ?`).run(id);
  db.prepare(`DELETE FROM vendor_models WHERE vendor_id = ?`).run(id);
  const result = db.prepare(`DELETE FROM vendors WHERE id = ?`).run(id);
  return result.changes > 0;
}

export function listBindings(): CapabilityBinding[] {
  const db = getDb();
  return db.prepare(`SELECT * FROM capability_bindings`).all() as CapabilityBinding[];
}

export function getBinding(capability: Capability): CapabilityBinding | undefined {
  const db = getDb();
  return db.prepare(`SELECT * FROM capability_bindings WHERE capability = ?`).get(capability) as CapabilityBinding | undefined;
}

export function setBinding(capability: Capability, vendor_id: string, model: string): CapabilityBinding {
  const db = getDb();
  db.prepare(`
    INSERT INTO capability_bindings (capability, vendor_id, model) VALUES (?, ?, ?)
    ON CONFLICT(capability) DO UPDATE SET vendor_id = excluded.vendor_id, model = excluded.model
  `).run(capability, vendor_id, model);
  return { capability, vendor_id, model };
}

export function defaultModelsForKind(kind: string): Array<{ model: string; capabilities: Capability[] }> {
  const integration = getIntegration(kind);
  const byModel = new Map<string, Capability[]>();
  for (const [cap, model] of Object.entries(integration.defaultModels)) {
    if (!model) continue;
    const list = byModel.get(model) || [];
    list.push(cap as Capability);
    byModel.set(model, list);
  }
  if (byModel.size === 0 && integration.capabilities.length) {
    return [{ model: integration.id, capabilities: [...integration.capabilities] }];
  }
  return [...byModel.entries()].map(([model, capabilities]) => ({ model, capabilities }));
}

/** Ensure a Grok vendor row exists so the UI has the baseline. Does not create bindings (legacy settings stay in charge until the UI assigns). */
export function ensureDefaultVendor(): Vendor {
  const existing = getVendor('grok');
  const base = getSetting('base_url', process.env.GROK_BASE_URL || '');
  const key = getSetting('api_key', process.env.GROK_API_KEY || '');
  if (existing) {
    if (!existing.base_url && base) {
      return upsertVendor({
        id: 'grok',
        kind: 'grok',
        label: existing.label || 'Grok',
        base_url: base,
        api_key: existing.api_key || key,
        extra: existing.extra,
        models: existing.models.map((m) => ({ model: m.model, capabilities: m.capabilities, extra: m.extra || undefined })),
      });
    }
    return existing;
  }
  return upsertVendor({
    id: 'grok',
    kind: 'grok',
    label: 'Grok',
    base_url: base,
    api_key: key,
    models: defaultModelsForKind('grok'),
  });
}

export function publicVendor(v: Vendor): Omit<Vendor, 'api_key'> & { api_key: string } {
  return { ...v, api_key: v.api_key ? '********' : '' };
}
