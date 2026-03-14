class ThreadService {
  constructor(store) {
    this.store = store;
  }

  createThread({ threadId, title = null, tags = [], at }) {
    this.store.appendEvent({ type: 'thread.created', threadId, title, tags, at });
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

  listThreads({ tag } = {}) {
    return this.store.listThreads({ tag });
  }

  readThread(threadId) {
    return this.store.getThread(threadId);
  }
}

module.exports = {
  ThreadService,
};
