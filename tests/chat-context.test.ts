import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { rmSync, existsSync, mkdirSync } from 'fs';
import { vi } from 'vitest';
import {
  KEEP_PREFIX,
  MAX_RECENT,
  SUMMARIZE_MIN,
  buildChatContext,
  shouldAutoSummarize,
  usableTurns,
} from '../app/lib/chat-context';

describe('buildChatContext (prompt-cache prefix)', () => {
  it('sends the full thread while it still fits', () => {
    const msgs = Array.from({ length: KEEP_PREFIX + MAX_RECENT }, (_, i) => ({
      role: i % 2 ? 'assistant' : 'user',
      content: `m${i}`,
    }));
    const out = buildChatContext(msgs, 'should-not-appear');
    expect(out).toHaveLength(KEEP_PREFIX + MAX_RECENT);
    expect(out.some((m) => m.role === 'system')).toBe(false);
    expect(out[0].content).toBe('m0');
    expect(out.at(-1)?.content).toBe(`m${msgs.length - 1}`);
  });

  it('injects a stable summary prefix once the thread would drop the middle', () => {
    const msgs = Array.from({ length: 24 }, (_, i) => ({
      role: i % 2 ? 'assistant' : 'user',
      content: `turn-${i}`,
    }));
    const out = buildChatContext(msgs, '角色是Vivian，正在海边');
    expect(out[0]).toEqual({ role: 'system', content: '[对话摘要]\n角色是Vivian，正在海边' });
    expect(out[1].content).toBe('turn-0');
    expect(out[KEEP_PREFIX].content).toBe('turn-2');
    expect(out).toHaveLength(1 + KEEP_PREFIX + MAX_RECENT);
    expect(out.at(-1)?.content).toBe('turn-23');
    expect(out.some((m) => m.content === 'turn-3')).toBe(false);
  });

  it('drops the middle without a summary until auto-summarize catches up', () => {
    const msgs = Array.from({ length: 24 }, (_, i) => ({
      role: i % 2 ? 'assistant' : 'user',
      content: `turn-${i}`,
    }));
    const out = buildChatContext(msgs, null);
    expect(out[0].content).toBe('turn-0');
    expect(out).toHaveLength(KEEP_PREFIX + MAX_RECENT);
    expect(out.some((m) => m.role === 'system')).toBe(false);
  });

  it('skips pending/error/empty turns', () => {
    const out = usableTurns([
      { role: 'user', content: 'hi', status: 'completed' },
      { role: 'assistant', content: '', status: 'pending' },
      { role: 'assistant', content: 'nope', status: 'error' },
      { role: 'system', content: 'ignore' },
    ]);
    expect(out).toEqual([{ role: 'user', content: 'hi', status: 'completed' }]);
  });
});

describe('shouldAutoSummarize', () => {
  it('waits until the send window would overflow', () => {
    expect(shouldAutoSummarize(SUMMARIZE_MIN - 1, null)).toBe(false);
    expect(shouldAutoSummarize(SUMMARIZE_MIN, null)).toBe(true);
  });

  it('re-summarizes after a full recent window of new turns', () => {
    const at = '2026-01-01T00:00:00.000Z';
    const created = Array.from({ length: 30 }, (_, i) =>
      i < 14 ? '2025-12-01T00:00:00.000Z' : `2026-02-01T00:00:${String(i).padStart(2, '0')}.000Z`
    );
    expect(shouldAutoSummarize(30, 'old', at, created)).toBe(true);
    expect(shouldAutoSummarize(30, 'old', at, created.slice(0, 10))).toBe(false);
  });
});

const TEST_DATA_DIR = join(process.cwd(), 'tests', '.tmp-chat-context-db');
process.env.DATA_DIR = TEST_DATA_DIR;
if (!existsSync(TEST_DATA_DIR)) mkdirSync(TEST_DATA_DIR, { recursive: true });

describe('message edit/retry DB helpers', () => {
  let db: typeof import('../app/lib/db');

  beforeAll(async () => {
    vi.resetModules();
    process.env.DATA_DIR = TEST_DATA_DIR;
    db = await import('../app/lib/db');
  });

  afterAll(() => {
    if (existsSync(TEST_DATA_DIR)) {
      try { rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch {}
    }
  });

  it('updates a user message and deletes everything after it', () => {
    const conv = db.createConversation('edit-retry');
    const u1 = db.addMessage(conv.id, 'user', 'first');
    db.addMessage(conv.id, 'assistant', 'a1');
    const u2 = db.addMessage(conv.id, 'user', 'second');
    db.addMessage(conv.id, 'assistant', 'a2');

    db.updateMessageContent(u2.id, 'second-edited');
    const removed = db.deleteMessagesAfter(conv.id, u2.id, false);
    expect(removed).toBe(1);
    const left = db.listMessages(conv.id);
    expect(left.map((m: any) => m.content)).toEqual(['first', 'a1', 'second-edited']);

    const a1 = left[1];
    db.deleteMessagesAfter(conv.id, a1.id, true);
    expect(db.listMessages(conv.id).map((m: any) => m.content)).toEqual(['first']);
    expect(db.getMessage(u1.id)?.content).toBe('first');
  });
});
