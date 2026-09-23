import { describe, it, expect } from 'vitest';
import { createSseParser, deltaFromSsePayload } from '../app/lib/sse';

describe('SSE line buffer', () => {
  it('reassembles a JSON payload split across chunks', () => {
    const parser = createSseParser();
    expect(parser.take('data: {"choices":[{"delta":{"con')).toEqual([]);
    const payloads = parser.take('tent":"hello"}}]}\n');
    expect(payloads).toHaveLength(1);
    expect(deltaFromSsePayload(payloads[0])).toBe('hello');
  });

  it('ignores [DONE] and empty data lines', () => {
    const parser = createSseParser();
    expect(parser.take('data: [DONE]\ndata:\n')).toEqual([]);
  });
});
