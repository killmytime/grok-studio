import type { ActiveBackends } from './integrations/catalog';

export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  last_message_at: string;
  summary?: string;
  summary_updated_at?: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
  status?: 'pending' | 'completed' | 'error';
  error_message?: string | null;
  extra_json?: Record<string, any> | null;
}

export interface ImageAsset {
  id: string;
  conversation_id: string;
  message_id: string | null;
  kind: 'generate' | 'edit' | 'upload';
  prompt: string;
  negative_prompt: string | null;
  model: string;
  aspect_ratio: string;
  resolution: string;
  quality: string | null;
  n_index: number;
  parent_image_id: string | null;
  file_path: string;
  thumb_path: string;
  mime: string;
  width: number;
  height: number;
  sha256: string;
  created_at: string;
  status?: 'pending' | 'completed' | 'error';
  error_message?: string | null;
  job_id?: string | null;
  extra_json?: Record<string, any> | null;
}

export interface GalleryImage extends ImageAsset {
  conversation_title: string | null;
}

export interface AppSettings {
  base_url: string;
  api_key: string;
  chat_model: string;
  image_model: string;
  default_aspect_ratio: string;
  default_resolution: string;
  default_n: string;
  edit_compatibility_mode: string;
  summary_prompt?: string;
  temperature?: string;
  max_tokens?: string;
  chat_provider?: string;
  chat_base_url?: string;
  chat_api_key?: string;
  image_generate_provider?: string;
  image_generate_base_url?: string;
  image_generate_api_key?: string;
  image_generate_model?: string;
  image_edit_provider?: string;
  image_edit_base_url?: string;
  image_edit_api_key?: string;
  image_edit_model?: string;
  jetson_gateway_url?: string;
  jetson_api_key?: string;
  jetson_steps?: string;
  jetson_seed?: string;
  app_version?: string;
  resolved_chat_base_url?: string;
  resolved_image_generate_base_url?: string;
  resolved_image_edit_base_url?: string;
  custom_system_prompt?: string;
  active?: ActiveBackends;
}
