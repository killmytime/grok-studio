import { bearerHeaders, resolveChatBackend, type CapabilityBackend } from '../backends';

export function assertChatConfigured(backend: CapabilityBackend = resolveChatBackend()): string | null {
  if (!backend.baseUrl) return 'Chat backend URL not configured';
  if (backend.provider !== 'ollama' && !backend.apiKey) return 'API not configured';
  return null;
}

export function chatHeaders(backend: CapabilityBackend): Record<string, string> {
  return bearerHeaders(backend.apiKey);
}

export async function fetchChatCompletions(
  body: Record<string, unknown>,
  backend: CapabilityBackend = resolveChatBackend()
): Promise<Response> {
  const err = assertChatConfigured(backend);
  if (err) {
    const e = new Error(err) as Error & { status: number };
    e.status = 400;
    throw e;
  }
  return fetch(`${backend.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: chatHeaders(backend),
    body: JSON.stringify({
      ...body,
      model: body.model || backend.model,
    }),
  });
}
