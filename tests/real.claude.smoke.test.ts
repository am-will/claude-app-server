import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRouter } from '../src/server/router.js';
import type { JsonRpcResponse, ServerEvent } from '../src/protocol/types.js';

const runReal = process.env.RUN_REAL_CLAUDE === '1';
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0, dirs.length)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createTempDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'claude-app-server-real-'));
  dirs.push(dir);
  return dir;
}

function hasSnakeCaseKeys(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => hasSnakeCaseKeys(item));
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).some(([key, nested]) => key.includes('_') || hasSnakeCaseKeys(nested));
  }
  return false;
}

function getResult<T = unknown>(response: JsonRpcResponse | undefined): T {
  expect(response).toBeDefined();
  if (!response || !('result' in response)) {
    throw new Error('Expected successful response');
  }
  return response.result as T;
}

describe.skipIf(!runReal)('real claude smoke', () => {
  it('gets a real Claude response through turn.start', async () => {
    const streamed: ServerEvent[] = [];
    const router = createRouter({
      dataDir: createTempDataDir(),
      providerOptions: {
        claudeMode: 'cli',
      },
      eventSink: (event) => streamed.push(event),
    });

    const threadOut = router.handle({
      jsonrpc: '2.0',
      id: 'smoke-thread',
      method: 'thread.start',
      params: {
        title: 'real smoke',
      },
    });

    const threadId = getResult<{ threadId: string }>(threadOut.response).threadId;

    const turnOut = router.handle({
      jsonrpc: '2.0',
      id: 'smoke-turn',
      method: 'turn.start',
      params: {
        provider: 'claude',
        threadId,
        input: 'Reply with exactly: CLAUDE_SERVER_SMOKE_OK',
      },
    });

    getResult(turnOut.response);

    const deadline = Date.now() + 20000;
    while (!streamed.some((event) => event.method === 'event.turnCompleted') && Date.now() < deadline) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const methods = streamed.map((event: ServerEvent) => event.method);
    expect(methods).toContain('event.turnStarted');
    expect(methods).toContain('event.turnCompleted');

    const deltas = streamed
      .filter((event) => event.method === 'event.turnDelta')
      .map((event) => String((event.params as Record<string, unknown>).chunk ?? ''));

    expect(deltas.join('')).toContain('CLAUDE_SERVER_SMOKE_OK');
    expect(hasSnakeCaseKeys(streamed)).toBe(false);
  });
});
