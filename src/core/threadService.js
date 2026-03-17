class ThreadService {
  constructor(store) {
    this.store = store;
  }

  createThread({ threadId, title = null, tags = [], cwd = null, provider = null, at }) {
    this.store.appendEvent({ type: 'thread.created', threadId, title, tags, cwd, provider, at });
    this.store.rebuildIndex();
    return this.readThread(threadId);
  }

  addMessage({ threadId, messageId, role, content, at }) {
    this.store.appendEvent({
      type: 'message.added',
      threadId,
      messageId,
      role,
      content,
      at,
    });
    this.store.rebuildIndex();
    return this.readThread(threadId);
  }

  listThreads({ tag, provider } = {}) {
    return this.store.listThreads({ tag, provider });
  }

  readThread(threadId) {
    return this.store.getThread(threadId);
  }
}

module.exports = {
  ThreadService,
};
