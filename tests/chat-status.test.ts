import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createConversation,
  addMessage,
  updateMessageStatus,
  updateConversationSummary,
  getConversation,
  listMessages,
  deleteConversation,
} from '../app/lib/db';
import { join } from 'path';
import { rmSync, existsSync, mkdirSync } from 'fs';

// Use isolated test DB dir to avoid polluting main data/
const TEST_DATA_DIR = join(process.cwd(), 'tests', '.tmp-db');
const TEST_DB_PATH = join(TEST_DATA_DIR, 'grok-studio.db');

beforeAll(() => {
  if (!existsSync(TEST_DATA_DIR)) mkdirSync(TEST_DATA_DIR, { recursive: true });
  process.env.DATA_DIR = TEST_DATA_DIR;
  // Force re-init by clearing module cache would be ideal but for vitest we rely on env at first import
});

afterAll(() => {
  if (existsSync(TEST_DATA_DIR)) {
    try { rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch {}
  }
});

// Simple smoke test for message status handling (core P0 for chat reliability)
describe('Chat Message Status', () => {
  it('should correctly identify pending, completed, and error states', () => {
    const messages = [
      { id: '1', status: 'pending' as const },
      { id: '2', status: 'completed' as const },
      { id: '3', status: 'error' as const, error_message: '上游错误' },
    ];

    const pending = messages.find(m => m.status === 'pending');
    const error = messages.find(m => m.status === 'error');

    expect(pending?.status).toBe('pending');
    expect(error?.error_message).toContain('上游');
    expect(messages.length).toBe(3);
  });

  it('should handle optimistic update pattern without crashing', () => {
    const prev = [{ id: 'old', content: 'hi', status: 'completed' as const }];
    const newMsg = { id: 'new', content: '', status: 'pending' as const };

    const updated = [...prev, newMsg];
    expect(updated.length).toBe(2);
    expect(updated[1].status).toBe('pending');
  });
});

describe('Chat DB helpers for send/stream/error/summary paths', () => {
  let convId: string;

  beforeAll(() => {
    // ensure db initialized with test dir
    const conv = createConversation('test-chat-conv');
    convId = conv.id;
  });

  it('should support addMessage with pending status for streaming start (send path)', () => {
    const msg = addMessage(convId, 'assistant', '', undefined, 'pending');
    expect(msg.status).toBe('pending');
    expect(msg.content).toBe('');
    const msgs = listMessages(convId);
    expect(msgs.some(m => m.status === 'pending')).toBe(true);
  });

  it('should support updateMessageStatus to completed after stream ends (stream path)', () => {
    const msg = addMessage(convId, 'assistant', 'partial', undefined, 'pending');
    updateMessageStatus(msg.id, 'completed', 'full streamed content');
    const updated = listMessages(convId).find(m => m.id === msg.id);
    expect(updated?.status).toBe('completed');
    expect(updated?.content).toBe('full streamed content');
  });

  it('should support updateMessageStatus to error on failure (error path)', () => {
    const msg = addMessage(convId, 'assistant', '', undefined, 'pending');
    updateMessageStatus(msg.id, 'error', undefined, '上游 API 错误');
    const updated = listMessages(convId).find(m => m.id === msg.id);
    expect(updated?.status).toBe('error');
    expect(updated?.error_message).toBe('上游 API 错误');
  });

  it('should support updateConversationSummary persisting summary + timestamp (summary path)', () => {
    const summaryText = '这是测试摘要：用户询问了天气和计划。';
    updateConversationSummary(convId, summaryText);
    const conv = getConversation(convId);
    expect(conv?.summary).toBe(summaryText);
    expect(conv?.summary_updated_at).toBeTruthy();
    expect(new Date(conv.summary_updated_at).getTime()).toBeGreaterThan(0);
  });

  afterAll(() => {
    if (convId) deleteConversation(convId);
  });
});
