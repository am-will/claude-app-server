import { describe, expect, it } from 'vitest';
import { buildClaudeCliArgs, ClaudeProviderAdapter, translateClaudeStreamEvents } from '../src/adapters/provider.js';

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

  it('builds Claude CLI args with model and conditional effort flags', () => {
    expect(
      buildClaudeCliArgs(
        {
          threadId: 'thread-1',
          turnId: 'turn-1',
          input: 'hello',
          model: 'claude-opus-4-6',
          effort: 'max',
        },
        'acceptEdits',
      ),
    ).toEqual(
      expect.arrayContaining(['--model', 'claude-opus-4-6', '--effort', 'max']),
    );

    expect(
      buildClaudeCliArgs(
        {
          threadId: 'thread-1',
          turnId: 'turn-1',
          input: 'hello',
          model: 'claude-haiku-4-5',
        },
        'acceptEdits',
      ),
    ).not.toContain('--effort');
  });

  it('does not duplicate final result text when deltas already streamed', () => {
    const streamedLines = [
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello ' } } },
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'world' } } },
      { type: 'result', result: 'Hello world' },
      { type: 'stream_event', event: { type: 'message_stop' } },
    ];

    let seenTextDelta = false;
    const emittedMethods: string[] = [];
    const emittedChunks: string[] = [];

    for (const line of streamedLines) {
      const hasResult = line.type === 'result';
      const hasDelta =
        (line.type === 'content_block_delta' && typeof line.delta?.text === 'string')
        || (line.type === 'stream_event'
          && line.event?.type === 'content_block_delta'
          && typeof line.event?.delta?.text === 'string');
      const suppressResultDelta = hasResult && !hasDelta && seenTextDelta;

      const events = translateClaudeStreamEvents([line], {
        threadId: 'thread-1',
        turnId: 'turn-1',
      });

      for (const event of events) {
        if (suppressResultDelta && event.method === 'event.turnDelta') continue;
        emittedMethods.push(event.method);
        if (event.method === 'event.turnDelta') {
          emittedChunks.push((event.params as { chunk?: string }).chunk ?? '');
          seenTextDelta = true;
        }
      }
    }

    expect(emittedMethods).toEqual([
      'event.turnDelta',
      'event.turnDelta',
      'event.turnCompleted',
      'event.turnCompleted',
    ]);
    expect(emittedChunks.join('')).toBe('Hello world');
  });
});
