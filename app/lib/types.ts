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
}
