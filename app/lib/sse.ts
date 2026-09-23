export function createSseParser() {
  let buffer = '';

  function take(text: string): string[] {
    buffer += text;
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    const payloads: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      payloads.push(payload);
    }
    return payloads;
  }

  function flush(): string[] {
    if (!buffer.trim()) return [];
    const leftover = buffer;
    buffer = '';
    return take(leftover + '\n');
  }

  return { take, flush };
}

export function deltaFromSsePayload(payload: string): string {
  try {
    const data = JSON.parse(payload);
    return data.choices?.[0]?.delta?.content || '';
  } catch {
    return '';
  }
}
