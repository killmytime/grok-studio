export const KEEP_PREFIX = 3;
export const MAX_RECENT = 16;
export const SUMMARIZE_MIN = KEEP_PREFIX + MAX_RECENT + 1;

export type ChatTurn = {
  role: string;
  content: string;
  status?: string | null;
  created_at?: string;
  extra_json?: { image_calls?: unknown } | null;
};

function turnHasBody(m: ChatTurn): boolean {
  if (String(m.content || '').trim()) return true;
  const calls = m.extra_json?.image_calls;
  return Array.isArray(calls) && calls.length > 0;
}

export function usableTurns<T extends ChatTurn>(msgs: T[]): T[] {
  return msgs.filter(
    (m) =>
      (m.role === 'user' || m.role === 'assistant') &&
      m.status !== 'pending' &&
      m.status !== 'error' &&
      turnHasBody(m)
  );
}

/** Same window buildChatContext sends: full thread, or summary + prefix + recent tail. */
export function windowTurns<T extends ChatTurn>(
  msgs: T[],
  summary?: string | null
): { summaryText: string | null; turns: T[] } {
  const turns = usableTurns(msgs);
  if (turns.length <= KEEP_PREFIX + MAX_RECENT) return { summaryText: null, turns };
  const summaryText = summary?.trim() || null;
  return {
    summaryText,
    turns: [...turns.slice(0, KEEP_PREFIX), ...turns.slice(-MAX_RECENT)],
  };
}

export function buildChatContext(
  msgs: ChatTurn[],
  summary?: string | null
): { role: string; content: string }[] {
  const { summaryText, turns } = windowTurns(msgs, summary);
  const mapped = turns.map((m) => ({ role: m.role, content: m.content }));
  if (summaryText) {
    return [{ role: 'system', content: `[对话摘要]\n${summaryText}` }, ...mapped];
  }
  return mapped;
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
