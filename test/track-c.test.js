const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ThreadStateStore } = require('../src/state');
const { ThreadService } = require('../src/core');
const { normalizeBoundaryInput } = require('../src/boundary');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'claude-app-server-'));
}

test('persistence round-trip: events rebuild into readable snapshot', () => {
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

  assert.equal(thread.threadId, 't-1');
  assert.equal(thread.title, 'Thread One');
  assert.equal(thread.messageCount, 1);
  assert.equal(thread.messages[0].content, 'hello');
});

test('thread list/read: ordering and tag filter basics', () => {
  const store = new ThreadStateStore({ baseDir: makeTempDir() });
  const service = new ThreadService(store);

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
  assert.equal(ordered[0].threadId, 'newer');
  assert.equal(ordered[1].threadId, 'older');

  const filtered = service.listThreads({ tag: 'alpha' });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].threadId, 'newer');

  const thread = service.readThread('older');
  assert.equal(thread.title, 'Older');
  assert.equal(thread.messages.length, 1);
});

test('boundary normalizer converts snake_case aliases to camelCase', () => {
  const input = {
    request_id: 'req-123',
    thread_id: 'thread-9',
    message_payload: {
      role_name: 'user',
    },
  };

  const normalized = normalizeBoundaryInput(input);

  assert.equal(normalized.requestId, 'req-123');
  assert.equal(normalized.threadId, 'thread-9');
  assert.equal(normalized.messagePayload.roleName, 'user');
  assert.equal(normalized.request_id, undefined);
  assert.equal(normalized.thread_id, undefined);
});
