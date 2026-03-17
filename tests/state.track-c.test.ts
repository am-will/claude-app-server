import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ThreadService } from '../src/core/threadService.js';
import { parseTurnStartParams } from '../src/protocol/schemas.js';
import { ThreadStateStore } from '../src/state/threadStore.js';

const dirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'claude-app-server-track-c-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0, dirs.length)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('track-c regression coverage', () => {
  it('persists events and rebuilds readable snapshot', () => {
    const baseDir = makeTempDir();
    const store = new ThreadStateStore({ baseDir });

    store.appendEvent({
      type: 'thread.created',
      threadId: 't-1',
      title: 'Thread One',
      tags: ['alpha'],
      at: '2026-01-01T00:00:00.000Z',
    });

    store.appendEvent({
      type: 'message.added',
      threadId: 't-1',
      messageId: 'm-1',
      role: 'user',
      content: 'hello',
      at: '2026-01-01T00:01:00.000Z',
    });

    store.rebuildIndex();

    const restored = new ThreadStateStore({ baseDir });
    const thread = restored.getThread('t-1');

    expect(thread?.threadId).toBe('t-1');
    expect(thread?.title).toBe('Thread One');
    expect(thread?.messageCount).toBe(1);
    expect(thread?.messages[0]?.content).toBe('hello');
  });

  it('supports thread ordering + tag filters through service layer', () => {
    const service = new ThreadService(new ThreadStateStore({ baseDir: makeTempDir() }));

    service.createThread({
      threadId: 'older',
      title: 'Older',
      tags: ['beta'],
      at: '2026-01-01T00:00:00.000Z',
    });

    service.addMessage({
      threadId: 'older',
      messageId: 'm-1',
      role: 'user',
      content: 'first',
      at: '2026-01-01T00:01:00.000Z',
    });

    service.createThread({
      threadId: 'newer',
      title: 'Newer',
      tags: ['alpha'],
      at: '2026-01-01T00:02:00.000Z',
    });

    service.addMessage({
      threadId: 'newer',
      messageId: 'm-2',
      role: 'assistant',
      content: 'second',
      at: '2026-01-01T00:03:00.000Z',
    });

    const ordered = service.listThreads();
    expect(ordered[0]?.threadId).toBe('newer');
    expect(ordered[1]?.threadId).toBe('older');

    const filtered = service.listThreads({ tag: 'alpha' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.threadId).toBe('newer');

    const thread = service.readThread('older');
    expect(thread?.title).toBe('Older');
    expect(thread?.messages).toHaveLength(1);
  });

  it('accepts snake_case aliases and normalizes turn params', () => {
    const parsed = parseTurnStartParams({
      thread_id: 'thread-9',
      input: 'hello',
      provider: 'claude',
    });

    expect(parsed.threadId).toBe('thread-9');
    expect(parsed.input).toBe('hello');
    expect(parsed.provider).toBe('claude');
  });
});
