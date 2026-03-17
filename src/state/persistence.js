const fs = require('node:fs');
const path = require('node:path');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return fallback;
  return JSON.parse(raw);
}

function appendJsonl(filePath, entry) {
  fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
}

class ThreadStateStore {
  constructor(options = {}) {
    const baseDir = options.baseDir || path.resolve(process.cwd(), '.data');
    this.baseDir = baseDir;
    this.eventsPath = options.eventsPath || path.join(baseDir, 'events.jsonl');
    this.snapshotPath = options.snapshotPath || path.join(baseDir, 'snapshot.json');

    ensureDir(path.dirname(this.eventsPath));
    ensureDir(path.dirname(this.snapshotPath));
    if (!fs.existsSync(this.eventsPath)) fs.writeFileSync(this.eventsPath, '', 'utf8');
    if (!fs.existsSync(this.snapshotPath)) {
      fs.writeFileSync(this.snapshotPath, JSON.stringify({ threads: {}, updatedAt: null }, null, 2));
    }
  }

  appendEvent(event) {
    const record = {
      ...event,
      at: event.at || new Date().toISOString(),
    };
    appendJsonl(this.eventsPath, record);
    return record;
  }

  loadEvents() {
    if (!fs.existsSync(this.eventsPath)) return [];
    const raw = fs.readFileSync(this.eventsPath, 'utf8');
    if (!raw.trim()) return [];
    return raw
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }

  loadSnapshot() {
    return readJson(this.snapshotPath, { threads: {}, updatedAt: null });
  }

  saveSnapshot(snapshot) {
    const next = {
      ...snapshot,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(this.snapshotPath, JSON.stringify(next, null, 2), 'utf8');
    return next;
  }

  rebuildIndex() {
    const events = this.loadEvents();
    const threads = {};

    for (const event of events) {
      const threadId = event.threadId;
      if (!threadId) continue;

      if (!threads[threadId]) {
        threads[threadId] = {
          threadId,
          title: null,
          cwd: null,
          provider: null,
          createdAt: event.at,
          updatedAt: event.at,
          messageCount: 0,
          tags: [],
          messages: [],
        };
      }

      const thread = threads[threadId];

      switch (event.type) {
        case 'thread.created': {
          if (event.title) thread.title = event.title;
          if (event.cwd !== undefined) thread.cwd = event.cwd;
          if (event.provider !== undefined) thread.provider = event.provider;
          if (Array.isArray(event.tags)) thread.tags = [...event.tags];
          thread.createdAt = thread.createdAt || event.at;
          thread.updatedAt = event.at;
          break;
        }
        case 'thread.updated': {
          if (event.title !== undefined) thread.title = event.title;
          if (Array.isArray(event.tags)) thread.tags = [...event.tags];
          thread.updatedAt = event.at;
          break;
        }
        case 'message.added': {
          const message = {
            messageId: event.messageId,
            role: event.role,
            content: event.content,
            at: event.at,
          };
          thread.messages.push(message);
          thread.messageCount += 1;
          thread.updatedAt = event.at;
          break;
        }
        default:
          break;
      }
    }

    return this.saveSnapshot({ threads });
  }

  listThreads(filters = {}) {
    const snapshot = this.loadSnapshot();
    let items = Object.values(snapshot.threads || {});

    if (filters.tag) {
      items = items.filter((t) => Array.isArray(t.tags) && t.tags.includes(filters.tag));
    }
    if (filters.provider) {
      items = items.filter((t) => t.provider === filters.provider);
    }

    items.sort((a, b) => {
      const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return bTime - aTime;
    });

    return items;
  }

  getThread(threadId) {
    const snapshot = this.loadSnapshot();
    return snapshot.threads?.[threadId] || null;
  }
}

module.exports = {
  ThreadStateStore,
};
