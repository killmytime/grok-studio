export type Capability = 'chat' | 'image.generate' | 'image.edit';

export interface IntegrationField {
  key: string;
  label: string;
  hint?: string;
  kind?: 'url' | 'password' | 'text';
  placeholder?: string;
}

export interface IntegrationManifest {
  id: string;
  aliases?: string[];
  label: string;
  shortLabel: string;
  capabilities: Capability[];
  requiresApiKey: boolean;
  defaultModels: Partial<Record<Capability, string>>;
  extraFields?: IntegrationField[];
  notes?: string;
}

export interface ActiveSlot {
  integration: string;
  label: string;
  model: string;
  capabilities: Capability[];
}

export interface ActiveBackends {
  chat: ActiveSlot;
  generate: ActiveSlot & { supportsEdit: boolean };
  edit: ActiveSlot & { available: boolean; reason?: string };
}

/** Grok is the baseline. Additional integrations plug in by declaring capabilities. */
export const INTEGRATIONS: IntegrationManifest[] = [
  {
    id: 'grok',
    label: 'Grok',
    shortLabel: 'Grok',
    capabilities: ['chat', 'image.generate', 'image.edit'],
    requiresApiKey: true,
    defaultModels: {
      chat: 'grok-latest',
      'image.generate': 'grok-imagine-image-2.0',
      'image.edit': 'grok-imagine-image-2.0',
    },
    notes: '基本盘：聊天、生图、改图。',
  },
  {
    id: 'ollama',
    label: 'Ollama',
    shortLabel: 'Ollama',
    capabilities: ['chat'],
    requiresApiKey: false,
    defaultModels: { chat: 'llama3.2' },
    extraFields: [
      { key: 'chat_base_url', label: 'Ollama URL', hint: '如 http://127.0.0.1:11434/v1', kind: 'url', placeholder: 'http://127.0.0.1:11434/v1' },
    ],
    notes: '仅聊天。不需要 API Key。',
  },
  {
    id: 'imagen',
    aliases: ['jetson'],
    label: 'Imagen (Z-Image-Turbo)',
    shortLabel: 'Imagen',
    capabilities: ['image.generate'],
    requiresApiKey: false,
    defaultModels: { 'image.generate': 'sd-cpp-local' },
    extraFields: [
      { key: 'jetson_gateway_url', label: 'Imagen URL', hint: 'https://imagen-ai.<微服>.heiyu.space', kind: 'url', placeholder: 'https://imagen-ai.xxx.heiyu.space' },
      { key: 'jetson_api_key', label: 'API Key', hint: '通常不需要', kind: 'password' },
      { key: 'jetson_steps', label: 'Steps (0–9)', hint: '空=后端默认 7，推荐 9', placeholder: '9' },
      { key: 'jetson_seed', label: 'Seed', hint: '空=随机', placeholder: '可选' },
    ],
    notes: '只支持文生图，不能改图。改图仍走 Grok。',
  },
];

export function getIntegration(id: string | undefined | null): IntegrationManifest {
  const key = (id || 'grok').toLowerCase().trim();
  return INTEGRATIONS.find((i) => i.id === key || i.aliases?.includes(key)) || INTEGRATIONS[0];
}

export function canonicalIntegrationId(id: string | undefined | null): string {
  return getIntegration(id).id;
}

export function hasCapability(id: string | undefined | null, cap: Capability): boolean {
  return getIntegration(id).capabilities.includes(cap);
}

export function integrationsFor(cap: Capability): IntegrationManifest[] {
  return INTEGRATIONS.filter((i) => i.capabilities.includes(cap));
}

export type SettingsLike = {
  chat_provider?: string;
  chat_model?: string;
  image_generate_provider?: string;
  image_generate_model?: string;
  image_model?: string;
  image_edit_provider?: string;
  image_edit_model?: string;
  active?: ActiveBackends;
};

export function describeFromSettings(s: SettingsLike): ActiveBackends {
  const chatI = getIntegration(s.chat_provider || 'grok');
  const genI = getIntegration(s.image_generate_provider || 'grok');
  const editI = getIntegration(s.image_edit_provider || 'grok');
  const chatModel = s.chat_model || chatI.defaultModels.chat || '';
  const genModel = s.image_generate_model || genI.defaultModels['image.generate'] || s.image_model || '';
  const editModel = s.image_edit_model || editI.defaultModels['image.edit'] || s.image_model || '';
  const editOk = hasCapability(editI.id, 'image.edit');
  return {
    chat: { integration: chatI.id, label: chatI.label, model: chatModel, capabilities: [...chatI.capabilities] },
    generate: {
      integration: genI.id,
      label: genI.label,
      model: genModel,
      capabilities: [...genI.capabilities],
      supportsEdit: hasCapability(genI.id, 'image.edit'),
    },
    edit: {
      integration: editI.id,
      label: editI.label,
      model: editModel,
      capabilities: [...editI.capabilities],
      available: editOk,
      reason: editOk ? undefined : `${editI.label} 不支持改图`,
    },
  };
}
