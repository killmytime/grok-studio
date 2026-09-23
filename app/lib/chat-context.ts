export const KEEP_PREFIX = 3;
export const MAX_RECENT = 16;
export const SUMMARIZE_MIN = KEEP_PREFIX + MAX_RECENT + 1;

export type ChatTurn = {
  role: string;
  content: string;
  status?: string | null;
  created_at?: string;
};

export function usableTurns<T extends ChatTurn>(msgs: T[]): T[] {
  return msgs.filter(
    (m) =>
      (m.role === 'user' || m.role === 'assistant') &&
      m.status !== 'pending' &&
      m.status !== 'error' &&
      String(m.content || '').trim()
  );
}

export function buildChatContext(
  msgs: ChatTurn[],
  summary?: string | null
): { role: string; content: string }[] {
  const turns = usableTurns(msgs);
  const mapped = turns.map((m) => ({ role: m.role, content: m.content }));

  if (mapped.length <= KEEP_PREFIX + MAX_RECENT) return mapped;

  const prefix = mapped.slice(0, KEEP_PREFIX);
  const recent = mapped.slice(-MAX_RECENT);
  const text = summary?.trim();
  if (text) {
    return [{ role: 'system', content: `[对话摘要]\n${text}` }, ...prefix, ...recent];
  }
  return [...prefix, ...recent];
}

export function shouldAutoSummarize(
  usableCount: number,
  summary?: string | null,
  summaryUpdatedAt?: string | null,
  createdAts: string[] = []
): boolean {
  if (usableCount < SUMMARIZE_MIN) return false;
  if (!summary?.trim()) return true;
  if (!summaryUpdatedAt) return true;
  const newer = createdAts.filter((t) => t > summaryUpdatedAt).length;
  return newer >= MAX_RECENT;
}
