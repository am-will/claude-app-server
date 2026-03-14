import { createProviderAdapters, type ProviderAdapter } from '../adapters/provider.js';
import { ThreadService } from '../core/threadService.js';
import {
  buildInvalidRequestError,
  parseJsonRpcMessage,
  parseThreadListParams,
  parseThreadReadParams,
  parseThreadStartParams,
  parseTurnStartParams,
  requestSchema,
} from '../protocol/schemas.js';
import type {
  JsonRpcErrorResponse,
  JsonRpcResponse,
  JsonRpcSuccessResponse,
  ParsedJsonRpcMessage,
  ServerEvent,
} from '../protocol/types.js';
import { createTurnStartedEvent } from './events.js';
import { ThreadStateStore } from '../state/threadStore.js';

const SUPPORTED_METHODS = [
  'session.initialize',
  'capability.list',
  'thread.start',
  'thread.list',
  'thread.read',
  'turn.start',
] as const;

interface RouterOutput {
  response: JsonRpcResponse | undefined;
  events: ServerEvent[];
}

interface RouterState {
  sessionId: string | null;
}

function nextId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function assertCamelCaseKeys(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      assertCamelCaseKeys(item);
    }
    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (key.includes('_')) {
      throw new Error(`snake_case key emitted by router: ${key}`);
    }
    assertCamelCaseKeys(nested);
  }
}

function ok<TResult>(id: JsonRpcSuccessResponse<TResult>['id'], result: TResult): JsonRpcSuccessResponse<TResult> {
  const response: JsonRpcSuccessResponse<TResult> = {
    jsonrpc: '2.0',
    id,
    result,
  };
  assertCamelCaseKeys(response);
  return response;
}

function error(id: JsonRpcErrorResponse['id'], code: number, message: string): JsonRpcErrorResponse {
  const response: JsonRpcErrorResponse = {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
    },
  };
  assertCamelCaseKeys(response);
  return response;
}

export interface Router {
  handle(input: unknown): RouterOutput;
}

export interface CreateRouterOptions {
  dataDir?: string;
  threadService?: ThreadService;
  providers?: Record<'codex' | 'claude', ProviderAdapter>;
}

export function createRouter(options: CreateRouterOptions = {}): Router {
  const adapters = options.providers ?? createProviderAdapters();
  const threadService = options.threadService
    ?? new ThreadService(new ThreadStateStore({ baseDir: options.dataDir }));

  const state: RouterState = {
    sessionId: null,
  };

  return {
    handle(input: unknown): RouterOutput {
      const parsedMessageResult = parseJsonRpcMessageSafe(input);

      if (!parsedMessageResult.success) {
        return {
          response: buildInvalidRequestError(null, parsedMessageResult.error),
          events: [],
        };
      }

      const { kind, value } = parsedMessageResult.message;

      if (kind === 'notification') {
        if (!SUPPORTED_METHODS.includes(value.method as (typeof SUPPORTED_METHODS)[number])) {
          return {
            response: undefined,
            events: [],
          };
        }
      }

      if (value.method === 'session.initialize') {
        const sessionId = state.sessionId ?? nextId('sess');
        state.sessionId = sessionId;

        return {
          response: kind === 'request'
            ? ok(value.id, {
                sessionId,
                server: {
                  name: 'claude-app-server',
                  version: '0.1.0',
                },
                capabilities: [...SUPPORTED_METHODS],
              })
            : undefined,
          events: [],
        };
      }

      if (value.method === 'capability.list') {
        return {
          response: kind === 'request'
            ? ok(value.id, {
                capabilities: [...SUPPORTED_METHODS],
              })
            : undefined,
          events: [],
        };
      }

      if (value.method === 'thread.start') {
        try {
          const params = parseThreadStartParams(value.params ?? {});
          const threadId = nextId('thread');
          const created = threadService.createThread({
            threadId,
            title: params.title,
            tags: params.tags,
          });

          return {
            response: kind === 'request'
              ? ok(value.id, {
                  threadId: created.threadId,
                  created: true,
                })
              : undefined,
            events: [],
          };
        } catch {
          return {
            response: kind === 'request' ? error(value.id, -32602, 'Invalid params') : undefined,
            events: [],
          };
        }
      }

      if (value.method === 'thread.list') {
        try {
          const params = parseThreadListParams(value.params ?? {});
          const threads = threadService.listThreads(params);
          return {
            response: kind === 'request'
              ? ok(value.id, {
                  threads,
                })
              : undefined,
            events: [],
          };
        } catch {
          return {
            response: kind === 'request' ? error(value.id, -32602, 'Invalid params') : undefined,
            events: [],
          };
        }
      }

      if (value.method === 'thread.read') {
        try {
          const params = parseThreadReadParams(value.params ?? {});
          const thread = threadService.readThread(params.threadId);

          if (!thread) {
            return {
              response: kind === 'request' ? error(value.id, -32004, 'Thread not found') : undefined,
              events: [],
            };
          }

          return {
            response: kind === 'request' ? ok(value.id, { thread }) : undefined,
            events: [],
          };
        } catch {
          return {
            response: kind === 'request' ? error(value.id, -32602, 'Invalid params') : undefined,
            events: [],
          };
        }
      }

      if (value.method === 'turn.start') {
        try {
          const params = parseTurnStartParams(value.params ?? {});
          const existing = threadService.readThread(params.threadId);

          if (!existing) {
            return {
              response: kind === 'request' ? error(value.id, -32004, 'Thread not found') : undefined,
              events: [],
            };
          }

          const turnId = nextId('turn');
          const messageId = nextId('msg');
          const provider = params.provider ?? 'codex';

          threadService.addMessage({
            threadId: params.threadId,
            messageId,
            role: 'user',
            content: params.input,
          });

          const providerResult = adapters[provider].startTurn({
            threadId: params.threadId,
            turnId,
            input: params.input,
          });

          const events: ServerEvent[] = [
            createTurnStartedEvent({
              threadId: params.threadId,
              turnId,
              provider,
            }),
            ...providerResult.events,
          ];

          assertCamelCaseKeys(events);

          return {
            response: kind === 'request'
              ? ok(value.id, {
                  turnId,
                  status: 'started',
                  accepted: providerResult.accepted,
                })
              : undefined,
            events,
          };
        } catch {
          return {
            response: kind === 'request' ? error(value.id, -32602, 'Invalid params') : undefined,
            events: [],
          };
        }
      }

      if (kind === 'request') {
        return {
          response: error(value.id, -32601, 'Method not found'),
          events: [],
        };
      }

      return {
        response: undefined,
        events: [],
      };
    },
  };
}

function parseJsonRpcMessageSafe(input: unknown):
  | { success: true; message: ParsedJsonRpcMessage }
  | { success: false; error: string } {
  const probe = requestSchema.safeParse(input);
  if (probe.success) {
    return {
      success: true,
      message: {
        kind: 'request',
        value: probe.data,
      },
    };
  }

  try {
    return {
      success: true,
      message: parseJsonRpcMessage(input),
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown parse error',
    };
  }
}
