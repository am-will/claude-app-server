import type { ThreadRecord, ThreadStateStore } from '../state/threadStore.js';

export class ThreadService {
  public constructor(private readonly store: ThreadStateStore) {}

  public createThread(
    input: {
      threadId: string;
      title?: string;
      tags?: string[];
      cwd?: string;
      provider?: 'codex' | 'claude';
      at?: string;
    },
  ): ThreadRecord {
    this.store.appendEvent({
      type: 'thread.created',
      threadId: input.threadId,
      title: input.title,
      tags: input.tags,
      cwd: input.cwd,
      provider: input.provider,
      at: input.at,
    });
    this.store.rebuildIndex();

    const thread = this.readThread(input.threadId);
    if (!thread) {
      throw new Error(`Thread not found after create: ${input.threadId}`);
    }

    return thread;
  }

  public addMessage(input: {
    threadId: string;
    messageId: string;
    role: 'user' | 'assistant';
    content: string;
    at?: string;
  }): ThreadRecord {
    this.store.appendEvent({
      type: 'message.added',
      threadId: input.threadId,
      messageId: input.messageId,
      role: input.role,
      content: input.content,
      at: input.at,
    });
    this.store.rebuildIndex();

    const thread = this.readThread(input.threadId);
    if (!thread) {
      throw new Error(`Thread not found after message append: ${input.threadId}`);
    }

    return thread;
  }

  public listThreads(input: { tag?: string; provider?: 'codex' | 'claude' } = {}): ThreadRecord[] {
    return this.store.listThreads(input);
  }

  public readThread(threadId: string): ThreadRecord | null {
    return this.store.getThread(threadId);
  }
}
