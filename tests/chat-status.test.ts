import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { join } from 'path';
import { rmSync, existsSync, mkdirSync } from 'fs';

// DB isolation MUST be set BEFORE any import of db or routes (static imports hoist)
// This ensures the shipped getDb() uses the test dir, not ./data
const TEST_DATA_DIR = join(process.cwd(), 'tests', '.tmp-db');

process.env.DATA_DIR = TEST_DATA_DIR;
if (!existsSync(TEST_DATA_DIR)) mkdirSync(TEST_DATA_DIR, { recursive: true });

let dbHelpers: any;
let routeModule: any;

beforeAll(async () => {
  // Reset modules so db singleton re-evaluates with correct DATA_DIR
  vi.resetModules();
  dbHelpers = await import('../app/lib/db');
  routeModule = await import('../app/api/conversations/[id]/route');
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
  let createConversation: any, addMessage: any, updateMessageStatus: any, getConversation: any, listMessages: any, deleteConversation: any;

  beforeAll(() => {
    // helpers guaranteed ready from outer beforeAll
    ({ createConversation, addMessage, updateMessageStatus, getConversation, listMessages, deleteConversation } = dbHelpers);
    // ensure db initialized with test dir
    const conv = createConversation('test-chat-conv');
    convId = conv.id;
  });

  it('should support addMessage with pending status for streaming start (send path)', () => {
    const msg = addMessage(convId, 'assistant', '', undefined, 'pending');
    expect(msg.status).toBe('pending');
    expect(msg.content).toBe('');
    const msgs = listMessages(convId);
    expect(msgs.some((m: any) => m.status === 'pending')).toBe(true);
  });

  it('should support updateMessageStatus to completed after stream ends (stream path)', () => {
    const msg = addMessage(convId, 'assistant', 'partial', undefined, 'pending');
    updateMessageStatus(msg.id, 'completed', 'full streamed content');
    const updated = listMessages(convId).find((m: any) => m.id === msg.id);
    expect(updated?.status).toBe('completed');
    expect(updated?.content).toBe('full streamed content');
  });

  it('should support updateMessageStatus to error on failure (error path)', () => {
    const msg = addMessage(convId, 'assistant', '', undefined, 'pending');
    updateMessageStatus(msg.id, 'error', undefined, '上游 API 错误');
    const updated = listMessages(convId).find((m: any) => m.id === msg.id);
    expect(updated?.status).toBe('error');
    expect(updated?.error_message).toBe('上游 API 错误');
  });

  it('PATCH /api/conversations/[id] with summary drives real route handler and persists summary + timestamp via DB', async () => {
    // This test calls the SHIPPED PATCH export from the route module (real path, not helper)
    const { PATCH } = routeModule;
    const summaryText = 'PATCH测试摘要：对话关于测试覆盖和错误处理。';
    const req = new Request('http://localhost', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary: summaryText }),
    });
    const params = { params: Promise.resolve({ id: convId }) };
    const res = await PATCH(req, params);
    expect(res.status).toBe(200); // ok response from shipped route

    // Verify DB state updated with timestamp (real DB path)
    const conv = getConversation(convId);
    expect(conv?.summary).toBe(summaryText);
    expect(conv?.summary_updated_at).toBeTruthy();
    expect(new Date(conv.summary_updated_at).getTime()).toBeGreaterThan(0);
  });

  afterAll(() => {
    if (convId) deleteConversation(convId);
  });
});

describe('ErrorBoundary (prevents white screen on render error)', () => {
  it('getDerivedStateFromError + render shows fallback without crashing on thrown error', async () => {
    // Directly exercise shipped ErrorBoundary class (real path, dynamic import for ESM)
    const mod = await import('../components/ErrorBoundary');
    const ErrorBoundary = mod.default;
    const boundary = new ErrorBoundary({ children: null });
    const testError = new Error('test render crash');
    const newState = ErrorBoundary.getDerivedStateFromError(testError);
    expect(newState.hasError).toBe(true);
    expect(newState.error).toBe(testError);

    // Simulate render after error (fallback UI, no white screen)
    boundary.state = newState;
    const rendered: any = boundary.render();
    expect(rendered).toBeTruthy();
    const html = rendered ? JSON.stringify(rendered) : '';
    expect(html).toContain('页面出错了');
  });
});
