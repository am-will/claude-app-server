import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export interface ThreadMessageRecord {
  messageId: string;
  role: 'user' | 'assistant';
  content: string;
  at: string;
}

export interface ThreadRecord {
  threadId: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  tags: string[];
  messages: ThreadMessageRecord[];
}

export type ThreadEvent =
  | { type: 'thread.created'; threadId: string; title?: string | null; tags?: string[]; at?: string }
  | {
      type: 'message.added';
      threadId: string;
      messageId: string;
      role: 'user' | 'assistant';
      content: string;
      at?: string;
    };

interface Snapshot {
  threads: Record<string, ThreadRecord>;
  updatedAt: string | null;
}

function ensureDir(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true });
}

function readJson<T>(filePath: string, fallback: T): T {
  if (!existsSync(filePath)) return fallback;
  const raw = readFileSync(filePath, 'utf8').trim();
  if (!raw) return fallback;
  return JSON.parse(raw) as T;
}

export class ThreadStateStore {
  private readonly eventsPath: string;
  private readonly snapshotPath: string;

  public constructor(options: { baseDir?: string; eventsPath?: string; snapshotPath?: string } = {}) {
    const baseDir = options.baseDir ?? resolve(process.cwd(), '.data');
    this.eventsPath = options.eventsPath ?? join(baseDir, 'events.jsonl');
    this.snapshotPath = options.snapshotPath ?? join(baseDir, 'snapshot.json');

    ensureDir(dirname(this.eventsPath));
    ensureDir(dirname(this.snapshotPath));

    if (!existsSync(this.eventsPath)) {
      writeFileSync(this.eventsPath, '', 'utf8');
    }

    if (!existsSync(this.snapshotPath)) {
      writeFileSync(this.snapshotPath, JSON.stringify({ threads: {}, updatedAt: null } satisfies Snapshot, null, 2));
    }
  }

  public appendEvent(event: ThreadEvent): ThreadEvent & { at: string } {
    const normalized = {
      ...event,
      at: event.at ?? new Date().toISOString(),
    };

    appendFileSync(this.eventsPath, `${JSON.stringify(normalized)}\n`, 'utf8');
    return normalized;
  }

  public rebuildIndex(): Snapshot {
    const events = this.loadEvents();
    const threads: Record<string, ThreadRecord> = {};

    for (const event of events) {
      if (!threads[event.threadId]) {
        threads[event.threadId] = {
          threadId: event.threadId,
          title: null,
          createdAt: event.at,
          updatedAt: event.at,
          messageCount: 0,
          tags: [],
          messages: [],
        };
      }

      const thread = threads[event.threadId];

      if (event.type === 'thread.created') {
        thread.title = event.title ?? null;
        thread.tags = Array.isArray(event.tags) ? [...event.tags] : [];
        thread.createdAt = thread.createdAt || event.at;
        thread.updatedAt = event.at;
      }

      if (event.type === 'message.added') {
        thread.messages.push({
          messageId: event.messageId,
          role: event.role,
          content: event.content,
          at: event.at,
        });
        thread.messageCount += 1;
        thread.updatedAt = event.at;
      }
    }

    const snapshot: Snapshot = {
      threads,
      updatedAt: new Date().toISOString(),
    };

    writeFileSync(this.snapshotPath, JSON.stringify(snapshot, null, 2), 'utf8');
    return snapshot;
  }

  public listThreads(filters: { tag?: string } = {}): ThreadRecord[] {
    const snapshot = this.loadSnapshot();
    let list = Object.values(snapshot.threads);

    if (filters.tag) {
      list = list.filter((thread) => thread.tags.includes(filters.tag as string));
    }

    return list.sort((a, b) => {
      const aTime = Date.parse(a.updatedAt || a.createdAt);
      const bTime = Date.parse(b.updatedAt || b.createdAt);
      return bTime - aTime;
    });
  }

  public getThread(threadId: string): ThreadRecord | null {
    const snapshot = this.loadSnapshot();
    return snapshot.threads[threadId] ?? null;
  }

  private loadSnapshot(): Snapshot {
    return readJson<Snapshot>(this.snapshotPath, { threads: {}, updatedAt: null });
  }

  private loadEvents(): Array<ThreadEvent & { at: string }> {
    if (!existsSync(this.eventsPath)) return [];
    const raw = readFileSync(this.eventsPath, 'utf8').trim();
    if (!raw) return [];
    return raw
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ThreadEvent & { at: string });
  }
}
