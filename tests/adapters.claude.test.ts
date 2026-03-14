import { describe, expect, it } from 'vitest';
import { ClaudeProviderAdapter, translateClaudeStreamEvents } from '../src/adapters/provider.js';

function hasSnakeCaseKeys(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasSnakeCaseKeys);
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).some(([key, nested]) => key.includes('_') || hasSnakeCaseKeys(nested));
  }
  return false;
}

describe('Claude provider translation', () => {
  it('translates stream-json events into canonical server events', () => {
    const events = translateClaudeStreamEvents(
      [
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello ' } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'world' } },
        { type: 'message_stop' },
      ],
      { threadId: 'thread-1', turnId: 'turn-1' },
    );

    expect(events.map((event) => event.method)).toEqual([
      'event.turnDelta',
      'event.turnDelta',
      'event.turnCompleted',
    ]);
    expect(hasSnakeCaseKeys(events)).toBe(false);
  });

  it('adapter startTurn returns translated events', async () => {
    const adapter = new ClaudeProviderAdapter();
    const result = await adapter.startTurn({
      threadId: 'thread-1',
      turnId: 'turn-1',
      input: 'hello',
    });

    expect(result.accepted).toBe(true);
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.events.some((event) => event.method === 'event.turnDelta')).toBe(true);
    expect(hasSnakeCaseKeys(result.events)).toBe(false);
  });
});
