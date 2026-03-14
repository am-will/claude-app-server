import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0, dirs.length)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createTempDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'claude-app-server-'));
  dirs.push(dir);
  return dir;
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
        'thread.list',
        'thread.read',
        'turn.start',
      ],
    });
  });

  it('uses persistence-backed threads across router instances and supports thread.list + thread.read', () => {
    const dataDir = createTempDataDir();

    const routerA = createRouter({ dataDir });

    const threadOut = routerA.handle({
      jsonrpc: '2.0',
      id: 'req-thread',
      method: 'thread.start',
      params: {
        title: 'Demo Thread',
        tags: ['demo'],
      },
    });

    const threadId = getResult<{ threadId: string }>(threadOut.response).threadId;

    routerA.handle({
      jsonrpc: '2.0',
      id: 'req-turn',
      method: 'turn.start',
      params: {
        threadId,
        input: 'hello world',
      },
    });

    // New router instance reads from same persistence directory.
    const routerB = createRouter({ dataDir });

    const listOut = routerB.handle({
      jsonrpc: '2.0',
      id: 'req-list',
      method: 'thread.list',
      params: {
        tag: 'demo',
      },
    });

    const listResult = getResult<{ threads: Array<{ threadId: string; messageCount: number }> }>(listOut.response);
    expect(listResult.threads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          threadId,
          messageCount: 1,
        }),
      ]),
    );

    const readOut = routerB.handle({
      jsonrpc: '2.0',
      id: 'req-read',
      method: 'thread.read',
      params: {
        thread_id: threadId,
      },
    });

    const readResult = getResult<{ thread: { threadId: string; messages: Array<{ content: string }> } }>(readOut.response);
    expect(readResult.thread.threadId).toBe(threadId);
    expect(readResult.thread.messages[0]?.content).toBe('hello world');
    expect(hasSnakeCaseKeys(readOut)).toBe(false);
  });

  it('translates provider stream events into canonical camelCase server events', () => {
    const router = createRouter();

    const threadOut = router.handle({
      jsonrpc: '2.0',
      id: 'req-thread',
      method: 'thread.start',
    });

    const threadId = getResult<{ threadId: string }>(threadOut.response).threadId;

    const turnOut = router.handle({
      jsonrpc: '2.0',
      id: 'req-turn',
      method: 'turn.start',
      params: {
        threadId,
        input: 'translate this',
        provider: 'claude',
      },
    });

    expect(getResult(turnOut.response)).toMatchObject({
      turnId: expect.any(String),
      status: 'started',
    });
    expect(turnOut.events.map((event) => event.method)).toEqual(
      expect.arrayContaining(['event.turnStarted', 'event.turnDelta', 'event.turnCompleted']),
    );
    expect(hasSnakeCaseKeys(turnOut)).toBe(false);
  });

  it('returns method not found for unknown handlers', () => {
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
