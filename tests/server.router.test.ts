import { describe, expect, it } from 'vitest';
import type { JsonRpcResponse } from '../src/protocol/types.js';
import { createRouter } from '../src/server/router.js';

function hasSnakeCaseKeys(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => hasSnakeCaseKeys(item));
  }

  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).some(([key, entry]) => {
      if (key.includes('_')) return true;
      return hasSnakeCaseKeys(entry);
    });
  }

  return false;
}

function getResult<T = unknown>(response: JsonRpcResponse | undefined): T {
  expect(response).toBeDefined();
  if (!response || !('result' in response)) {
    throw new Error('Expected successful JSON-RPC response');
  }
  return response.result as T;
}

describe('server router', () => {
  it('handles session.initialize with canonical camelCase response', () => {
    const router = createRouter();
    const out = router.handle({
      jsonrpc: '2.0',
      id: 'req-1',
      method: 'session.initialize',
      params: {
        clientName: 'test-client',
      },
    });

    expect(getResult(out.response)).toMatchObject({
      sessionId: expect.any(String),
      server: {
        name: 'claude-app-server',
        version: expect.any(String),
      },
    });
    expect(hasSnakeCaseKeys(out)).toBe(false);
  });

  it('returns capabilities from capability.list', () => {
    const router = createRouter();
    const out = router.handle({
      jsonrpc: '2.0',
      id: 'req-2',
      method: 'capability.list',
    });

    expect(getResult(out.response)).toEqual({
      capabilities: [
        'session.initialize',
        'capability.list',
        'thread.start',
        'turn.start',
      ],
    });
  });

  it('starts thread and turn and emits mock stream events in camelCase', () => {
    const router = createRouter();

    const threadOut = router.handle({
      jsonrpc: '2.0',
      id: 'req-thread',
      method: 'thread.start',
      params: {
        title: 'Demo Thread',
      },
    });

    const threadId = getResult<{ threadId: string }>(threadOut.response).threadId;

    const turnOut = router.handle({
      jsonrpc: '2.0',
      id: 'req-turn',
      method: 'turn.start',
      params: {
        threadId,
        input: 'hello world',
      },
    });

    expect(getResult(turnOut.response)).toMatchObject({
      turnId: expect.any(String),
      status: 'started',
    });
    expect(turnOut.events).toHaveLength(2);
    expect(turnOut.events[0]?.method).toBe('event.turnStarted');
    expect(turnOut.events[1]?.method).toBe('event.turnDelta');
    expect(hasSnakeCaseKeys(turnOut)).toBe(false);
  });

  it('returns JSON-RPC method not found for unknown handlers', () => {
    const router = createRouter();
    const out = router.handle({
      jsonrpc: '2.0',
      id: 'req-unknown',
      method: 'unknown.method',
    });

    expect(out.response).toEqual({
      jsonrpc: '2.0',
      id: 'req-unknown',
      error: {
        code: -32601,
        message: 'Method not found',
      },
    });
  });
});
