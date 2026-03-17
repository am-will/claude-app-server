import { createProviderAdapters, type CreateProviderAdaptersOptions, type ProviderAdapter } from '../adapters/provider.js';
import { ThreadService } from '../core/threadService.js';
import { existsSync } from 'node:fs';
import {
  buildInvalidRequestError,
  MODEL_LIST_DATA,
  parseJsonRpcMessage,
  parseThreadListParams,
  parseThreadReadParams,
  parseThreadStartParams,
  parseTurnStartParams,
  parseSkillsListParams,
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
import { listSkillsForCwds } from '../skills/listSkills.js';
import type { ThreadMessageRecord } from '../state/threadStore.js';

const SUPPORTED_METHODS = [
  'session.initialize',
  'capability.list',
  'model.list',
  'thread.start',
  'thread.list',
  'thread.read',
  'turn.start',
  'skills.list',
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

function buildClaudeContinuationInput(history: ThreadMessageRecord[], latestUserInput: string): string {
  if (history.length === 0) {
    return latestUserInput;
  }

  // Keep history bounded so prompts remain stable even on long-running threads.
  const maxMessages = 40;
  const maxChars = 12000;
  const clippedHistory = history.slice(-maxMessages);
  const lines: string[] = [];
  let charCount = 0;

  for (let i = clippedHistory.length - 1; i >= 0; i -= 1) {
    const message = clippedHistory[i];
    const roleLabel = message.role === 'assistant' ? 'Assistant' : 'User';
    const line = `${roleLabel}: ${message.content}`;
    if (charCount + line.length > maxChars) {
      break;
    }
    lines.unshift(line);
    charCount += line.length;
  }

  return [
    'Continue this ongoing conversation using the prior messages as context.',
    'Conversation history:',
    ...lines,
    '',
    `User: ${latestUserInput}`,
    '',
    'Assistant:',
  ].join('\n');
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
  providerOptions?: CreateProviderAdaptersOptions;
  eventSink?: (event: ServerEvent) => void;
}

export function createRouter(options: CreateRouterOptions = {}): Router {
  const adapters = options.providers ?? createProviderAdapters(options.providerOptions);
  const threadService = options.threadService
    ?? new ThreadService(new ThreadStateStore({ baseDir: options.dataDir }));
  const pendingAssistantByTurnId = new Map<string, { threadId: string; chunks: string[] }>();

  const state: RouterState = {
    sessionId: null,
  };

  const emitEvent = (event: ServerEvent): void => {
    options.eventSink?.(event);
  };

  const startAssistantCapture = (threadId: string, turnId: string): void => {
    pendingAssistantByTurnId.set(turnId, { threadId, chunks: [] });
  };

  const persistAssistantIfCompleted = (event: ServerEvent): void => {
    const params = event.params;
    const turnId = typeof params.turnId === 'string' ? params.turnId : '';
    if (!turnId) {
      return;
    }

    const pending = pendingAssistantByTurnId.get(turnId);
    if (!pending) {
      return;
    }

    if (event.method === 'event.turnDelta') {
      const chunk = typeof params.chunk === 'string' ? params.chunk : '';
      if (chunk) {
        pending.chunks.push(chunk);
      }
      return;
    }

    if (event.method !== 'event.turnCompleted') {
      return;
    }

    const assistantContent = pending.chunks.join('');
    pendingAssistantByTurnId.delete(turnId);
    if (!assistantContent.trim()) {
      return;
    }
    threadService.addMessage({
      threadId: pending.threadId,
      messageId: nextId('msg'),
      role: 'assistant',
      content: assistantContent,
    });
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

      if (value.method === 'model.list') {
        return {
          response: kind === 'request'
            ? ok(value.id, {
                data: [...MODEL_LIST_DATA],
              })
            : undefined,
          events: [],
        };
      }

      if (value.method === 'thread.start') {
        try {
          const params = parseThreadStartParams(value.params ?? {});
          const threadId = nextId('thread');
          const provider = params.provider ?? 'claude';
          const created = threadService.createThread({
            threadId,
            title: params.title,
            tags: params.tags,
            cwd: params.cwd,
            provider,
          });

          return {
            response: kind === 'request'
              ? ok(value.id, {
                  threadId: created.threadId,
                  cwd: created.cwd,
                  provider: created.provider ?? provider,
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
          const allThreads = threadService.listThreads({
            ...params,
            provider: params.provider ?? 'claude',
          });
          const offset = params.cursor ? Number.parseInt(params.cursor, 10) : 0;
          const safeOffset = Number.isFinite(offset) && offset >= 0 ? offset : 0;
          const limit = params.limit ?? allThreads.length;
          const threads = allThreads.slice(safeOffset, safeOffset + limit);
          const nextCursor = safeOffset + limit < allThreads.length ? String(safeOffset + limit) : undefined;
          return {
            response: kind === 'request'
              ? ok(value.id, {
                  threads,
                  data: threads,
                  ...(nextCursor ? { nextCursor } : {}),
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
          const executionCwd = params.cwd ?? existing.cwd ?? process.cwd();
          const providerInput = provider === 'claude'
            ? buildClaudeContinuationInput(existing.messages, params.input)
            : params.input;

          if (!existsSync(executionCwd)) {
            return {
              response: kind === 'request'
                ? error(value.id, -32602, `Invalid params: cwd does not exist: ${executionCwd}`)
                : undefined,
              events: [],
            };
          }

          threadService.addMessage({
            threadId: params.threadId,
            messageId,
            role: 'user',
            content: params.input,
          });

          const startedEvent = createTurnStartedEvent({
            threadId: params.threadId,
            turnId,
            provider,
          });

          const events: ServerEvent[] = [startedEvent];

          // Immediate started event for synchronous response path.
          emitEvent(startedEvent);
          startAssistantCapture(params.threadId, turnId);

          if (
            provider === 'claude'
            && options.providerOptions?.claudeMode === 'cli'
            && adapters[provider].startTurnStreaming
          ) {
            void adapters[provider].startTurnStreaming(
              {
                threadId: params.threadId,
                turnId,
                input: providerInput,
                model: params.model,
                effort: params.effort,
                cwd: executionCwd,
              },
              (event) => {
                assertCamelCaseKeys(event);
                persistAssistantIfCompleted(event);
                emitEvent(event);
              },
            );
          } else {
            const providerResult = adapters[provider].startTurn({
              threadId: params.threadId,
              turnId,
              input: providerInput,
              model: params.model,
              effort: params.effort,
              cwd: executionCwd,
            });
            events.push(...providerResult.events);
            for (const event of providerResult.events) {
              persistAssistantIfCompleted(event);
              emitEvent(event);
            }
          }

          assertCamelCaseKeys(events);

          return {
            response: kind === 'request'
              ? ok(value.id, {
                  turnId,
                  status: 'started',
                  accepted: true,
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

      if (value.method === 'skills.list') {
        try {
          const params = parseSkillsListParams(value.params ?? {});
          const requestedCwds = params.cwds?.length
            ? params.cwds
            : [params.cwd ?? process.cwd()];
          const data = listSkillsForCwds(requestedCwds);

          return {
            response: kind === 'request' ? ok(value.id, { data }) : undefined,
            events: [],
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
