import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProviderAdapter } from '../src/adapters/provider.js';
import type { JsonRpcResponse } from '../src/protocol/types.js';
import { createTurnCompletedEvent, createTurnDeltaEvent } from '../src/server/events.js';
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
        'model.list',
        'thread.start',
        'thread.list',
        'thread.read',
        'turn.start',
        'skills.list',
      ],
    });
  });

  it('uses persistence-backed threads across router instances and supports thread.list + thread.read', () => {
    const dataDir = createTempDataDir();
    const workspaceCwd = join(dataDir, 'workspace');
    mkdirSync(workspaceCwd, { recursive: true });

    const routerA = createRouter({ dataDir });

    const threadOut = routerA.handle({
      jsonrpc: '2.0',
      id: 'req-thread',
      method: 'thread.start',
      params: {
        title: 'Demo Thread',
        tags: ['demo'],
        cwd: workspaceCwd,
      },
    });

    const threadStartResult = getResult<{ threadId: string; cwd: string }>(threadOut.response);
    const threadId = threadStartResult.threadId;
    expect(threadStartResult.cwd).toBe(workspaceCwd);

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
          messageCount: 2,
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
    expect((readResult.thread as { cwd?: string }).cwd).toBe(workspaceCwd);
    expect(readResult.thread.messages[0]?.content).toBe('hello world');
    expect(readResult.thread.messages[1]?.content).toBe('Codex received: hello world');
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

  it('persists assistant output for non-streaming provider events', () => {
    const router = createRouter();

    const threadOut = router.handle({
      jsonrpc: '2.0',
      id: 'req-thread-persist-sync',
      method: 'thread.start',
      params: {
        provider: 'claude',
      },
    });
    const threadId = getResult<{ threadId: string }>(threadOut.response).threadId;

    router.handle({
      jsonrpc: '2.0',
      id: 'req-turn-persist-sync',
      method: 'turn.start',
      params: {
        threadId,
        input: 'persist this',
        provider: 'claude',
      },
    });

    const readOut = router.handle({
      jsonrpc: '2.0',
      id: 'req-read-persist-sync',
      method: 'thread.read',
      params: { threadId },
    });
    const readResult = getResult<{ thread: { messages: Array<{ role: string; content: string }> } }>(readOut.response);
    expect(readResult.thread.messages).toHaveLength(2);
    expect(readResult.thread.messages[0]).toMatchObject({ role: 'user', content: 'persist this' });
    expect(readResult.thread.messages[1]).toMatchObject({ role: 'assistant' });
    expect(readResult.thread.messages[1]?.content).toContain('persist this');
  });

  it('persists assistant output for streaming provider events', () => {
    const streamingClaudeAdapter: ProviderAdapter = {
      name: 'claude',
      startTurn: () => ({
        accepted: true,
        providerMessage: 'unused for streaming path',
        events: [],
      }),
      async startTurnStreaming(input, emit) {
        emit(
          createTurnDeltaEvent({
            threadId: input.threadId,
            turnId: input.turnId,
            chunk: 'streamed reply',
          }),
        );
        emit(
          createTurnCompletedEvent({
            threadId: input.threadId,
            turnId: input.turnId,
          }),
        );
        return {
          accepted: true,
          providerMessage: 'streaming complete',
          events: [],
        };
      },
    };

    const codexAdapter: ProviderAdapter = {
      name: 'codex',
      startTurn(input) {
        return {
          accepted: true,
          providerMessage: 'codex mock',
          events: [
            createTurnDeltaEvent({
              threadId: input.threadId,
              turnId: input.turnId,
              chunk: input.input,
            }),
            createTurnCompletedEvent({
              threadId: input.threadId,
              turnId: input.turnId,
            }),
          ],
        };
      },
    };

    const router = createRouter({
      providers: {
        codex: codexAdapter,
        claude: streamingClaudeAdapter,
      },
      providerOptions: {
        claudeMode: 'cli',
      },
    });

    const threadOut = router.handle({
      jsonrpc: '2.0',
      id: 'req-thread-persist-stream',
      method: 'thread.start',
      params: {
        provider: 'claude',
      },
    });
    const threadId = getResult<{ threadId: string }>(threadOut.response).threadId;

    router.handle({
      jsonrpc: '2.0',
      id: 'req-turn-persist-stream',
      method: 'turn.start',
      params: {
        threadId,
        input: 'ignored',
        provider: 'claude',
      },
    });

    const readOut = router.handle({
      jsonrpc: '2.0',
      id: 'req-read-persist-stream',
      method: 'thread.read',
      params: { threadId },
    });
    const readResult = getResult<{ thread: { messages: Array<{ role: string; content: string }> } }>(readOut.response);
    expect(readResult.thread.messages).toHaveLength(2);
    expect(readResult.thread.messages[0]).toMatchObject({ role: 'user', content: 'ignored' });
    expect(readResult.thread.messages[1]).toMatchObject({ role: 'assistant', content: 'streamed reply' });
  });

  it('builds claude turn input with prior conversation context', () => {
    const seenInputs: string[] = [];
    const claudeAdapter: ProviderAdapter = {
      name: 'claude',
      startTurn(input) {
        seenInputs.push(input.input);
        return {
          accepted: true,
          providerMessage: 'ok',
          events: [
            createTurnDeltaEvent({
              threadId: input.threadId,
              turnId: input.turnId,
              chunk: 'assistant reply',
            }),
            createTurnCompletedEvent({
              threadId: input.threadId,
              turnId: input.turnId,
            }),
          ],
        };
      },
    };

    const codexAdapter: ProviderAdapter = {
      name: 'codex',
      startTurn(input) {
        return {
          accepted: true,
          providerMessage: 'ok',
          events: [
            createTurnDeltaEvent({
              threadId: input.threadId,
              turnId: input.turnId,
              chunk: input.input,
            }),
            createTurnCompletedEvent({
              threadId: input.threadId,
              turnId: input.turnId,
            }),
          ],
        };
      },
    };

    const router = createRouter({
      providers: {
        codex: codexAdapter,
        claude: claudeAdapter,
      },
    });

    const threadOut = router.handle({
      jsonrpc: '2.0',
      id: 'req-thread-context',
      method: 'thread.start',
      params: { provider: 'claude' },
    });
    const threadId = getResult<{ threadId: string }>(threadOut.response).threadId;

    router.handle({
      jsonrpc: '2.0',
      id: 'req-turn-context-1',
      method: 'turn.start',
      params: {
        threadId,
        input: 'first question',
        provider: 'claude',
      },
    });

    router.handle({
      jsonrpc: '2.0',
      id: 'req-turn-context-2',
      method: 'turn.start',
      params: {
        threadId,
        input: 'second question',
        provider: 'claude',
      },
    });

    expect(seenInputs).toHaveLength(2);
    expect(seenInputs[0]).toContain('first question');
    expect(seenInputs[1]).toContain('Conversation history:');
    expect(seenInputs[1]).toContain('User: first question');
    expect(seenInputs[1]).toContain('Assistant: assistant reply');
    expect(seenInputs[1]).toContain('User: second question');
  });

  it('returns model.list data in codex-compatible shape with defaults', () => {
    const router = createRouter();
    const out = router.handle({
      jsonrpc: '2.0',
      id: 'req-models',
      method: 'model.list',
    });

    const result = getResult<{ data: Array<{ id: string; isDefault: boolean; defaultReasoningEffort?: string }> }>(
      out.response,
    );
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'claude-sonnet-4-6',
          isDefault: true,
          defaultReasoningEffort: 'med',
        }),
      ]),
    );
    expect(hasSnakeCaseKeys(result)).toBe(false);
  });

  it('rejects invalid turn.start model and effort combinations with -32602', () => {
    const router = createRouter();
    const threadOut = router.handle({
      jsonrpc: '2.0',
      id: 'req-thread',
      method: 'thread.start',
    });
    const threadId = getResult<{ threadId: string }>(threadOut.response).threadId;

    const turnOut = router.handle({
      jsonrpc: '2.0',
      id: 'req-turn-invalid',
      method: 'turn.start',
      params: {
        threadId,
        input: 'hello',
        model: 'claude-haiku-4-5',
        effort: 'low',
      },
    });

    expect(turnOut.response).toEqual({
      jsonrpc: '2.0',
      id: 'req-turn-invalid',
      error: {
        code: -32602,
        message: 'Invalid params',
      },
    });
  });

  it('rejects turn.start when cwd does not exist', () => {
    const router = createRouter();
    const threadOut = router.handle({
      jsonrpc: '2.0',
      id: 'req-thread-cwd',
      method: 'thread.start',
    });
    const threadId = getResult<{ threadId: string }>(threadOut.response).threadId;

    const turnOut = router.handle({
      jsonrpc: '2.0',
      id: 'req-turn-missing-cwd',
      method: 'turn.start',
      params: {
        threadId,
        input: 'hello',
        provider: 'claude',
        cwd: '/this/path/does/not/exist',
      },
    });

    expect(turnOut.response).toEqual({
      jsonrpc: '2.0',
      id: 'req-turn-missing-cwd',
      error: {
        code: -32602,
        message: 'Invalid params: cwd does not exist: /this/path/does/not/exist',
      },
    });
  });

  it('returns skills.list data in codex-compatible shape', () => {
    const dataDir = createTempDataDir();
    const cwd = join(dataDir, 'repo');
    const skillDir = join(cwd, '.claude', 'skills', 'read-github');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '# read-github\n\nRead docs from GitHub repositories quickly.\n',
      'utf8',
    );

    const router = createRouter();
    const out = router.handle({
      jsonrpc: '2.0',
      id: 'req-skills',
      method: 'skills.list',
      params: {
        cwd,
      },
    });

    const result = getResult<{ data: Array<{ cwd: string; skills: Array<{ name: string; shortDescription: string; scope: string }> }> }>(out.response);

    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.cwd).toBe(cwd);
    expect(result.data[0]?.skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'read-github',
          shortDescription: 'Read docs from GitHub repositories quickly.',
          scope: 'workspace',
        }),
      ]),
    );
    expect(hasSnakeCaseKeys(result)).toBe(false);
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

  it('thread.list is provider-scoped to claude by default', () => {
    const router = createRouter();

    const claudeThreadOut = router.handle({
      jsonrpc: '2.0',
      id: 'req-thread-claude',
      method: 'thread.start',
      params: { provider: 'claude' },
    });
    const claudeThreadId = getResult<{ threadId: string }>(claudeThreadOut.response).threadId;

    router.handle({
      jsonrpc: '2.0',
      id: 'req-thread-codex',
      method: 'thread.start',
      params: { provider: 'codex' },
    });

    const listOut = router.handle({
      jsonrpc: '2.0',
      id: 'req-list-provider-default',
      method: 'thread.list',
      params: { limit: 1, cursor: '0' },
    });

    const listResult = getResult<{
      threads: Array<{ threadId: string; provider?: string | null }>;
      data: Array<{ threadId: string; provider?: string | null }>;
      nextCursor?: string;
    }>(listOut.response);
    expect(listResult.threads.map((t) => t.threadId)).toContain(claudeThreadId);
    expect(listResult.data).toEqual(listResult.threads);
    expect(listResult.threads.every((t) => t.provider === 'claude')).toBe(true);
  });
});
