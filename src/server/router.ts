import { createProviderAdapters } from '../adapters/provider.js';
import {
  buildInvalidRequestError,
  parseJsonRpcMessage,
  requestSchema,
} from '../protocol/schemas.js';
import type {
  JsonRpcErrorResponse,
  JsonRpcResponse,
  JsonRpcSuccessResponse,
  ServerEvent,
  TurnStartParams,
} from '../protocol/types.js';
import { createTurnDeltaEvent, createTurnStartedEvent } from './events.js';

const SUPPORTED_METHODS = [
  'session.initialize',
  'capability.list',
  'thread.start',
  'turn.start',
] as const;

interface RouterOutput {
  response: JsonRpcResponse | undefined;
  events: ServerEvent[];
}

interface RouterState {
  sessionId: string | null;
  threads: Set<string>;
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

export function createRouter(): Router {
  const adapters = createProviderAdapters();
  const state: RouterState = {
    sessionId: null,
    threads: new Set(),
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
        const threadId = nextId('thread');
        state.threads.add(threadId);

        return {
          response: kind === 'request'
            ? ok(value.id, {
                threadId,
                created: true,
              })
            : undefined,
          events: [],
        };
      }

      if (value.method === 'turn.start') {
        const params = (value.params ?? {}) as TurnStartParams;

        if (!params.threadId || !params.input) {
          return {
            response: kind === 'request' ? error(value.id, -32602, 'Invalid params') : undefined,
            events: [],
          };
        }

        if (!state.threads.has(params.threadId)) {
          return {
            response: kind === 'request' ? error(value.id, -32004, 'Thread not found') : undefined,
            events: [],
          };
        }

        const turnId = nextId('turn');
        const provider = params.provider ?? 'codex';

        // Fire-and-forget stub adapter kickoff for stream provider.
        void adapters[provider].startTurn({
          threadId: params.threadId,
          turnId,
          input: params.input,
        });

        const events = [
          createTurnStartedEvent({
            threadId: params.threadId,
            turnId,
            provider,
          }),
          createTurnDeltaEvent({
            threadId: params.threadId,
            turnId,
            chunk: 'Mock stream kickoff',
          }),
        ];

        assertCamelCaseKeys(events);

        return {
          response: kind === 'request'
            ? ok(value.id, {
                turnId,
                status: 'started',
              })
            : undefined,
          events,
        };
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
  | { success: true; message: ReturnType<typeof parseJsonRpcMessage> }
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
