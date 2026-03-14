import { z } from 'zod';
import type {
  JsonRpcErrorResponse,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
  ParsedJsonRpcMessage,
  ThreadListParams,
  ThreadReadParams,
  ThreadStartParams,
  TurnStartParams,
  SkillsListParams,
} from './types.js';

const camelCaseSegment = '[a-z][A-Za-z0-9]*';
const methodRegex = new RegExp(`^${camelCaseSegment}(\\.${camelCaseSegment})*$`);

const methodSchema = z
  .string()
  .regex(methodRegex, 'method must be dot-separated camelCase (for example session.initialize)');

const jsonRpcVersionSchema = z.literal('2.0');
const jsonRpcIdSchema = z.union([z.string(), z.number().finite(), z.null()]);

const paramsSchema = z.record(z.string(), z.unknown()).optional();

export const requestSchema = z.object({
  jsonrpc: jsonRpcVersionSchema,
  id: jsonRpcIdSchema,
  method: methodSchema,
  params: paramsSchema,
});

export const notificationSchema = z.object({
  jsonrpc: jsonRpcVersionSchema,
  method: methodSchema,
  params: paramsSchema,
});

const jsonRpcErrorSchema = z.object({
  code: z.number().int(),
  message: z.string().min(1),
  data: z.unknown().optional(),
});

export const responseSchema = z.union([
  z.object({
    jsonrpc: jsonRpcVersionSchema,
    id: jsonRpcIdSchema,
    result: z.unknown(),
  }),
  z.object({
    jsonrpc: jsonRpcVersionSchema,
    id: jsonRpcIdSchema,
    error: jsonRpcErrorSchema,
  }),
]);

const messageSchema = z.union([requestSchema, notificationSchema]);

const threadStartParamsSchema = z
  .object({
    title: z.string().min(1).optional(),
    tags: z.array(z.string().min(1)).optional(),
  })
  .strict();

const threadListParamsSchema = z
  .object({
    tag: z.string().min(1).optional(),
  })
  .strict();

const threadReadParamsSchema = z
  .object({
    threadId: z.string().min(1),
  })
  .strict();

const turnStartParamsSchema = z
  .object({
    threadId: z.string().min(1),
    input: z.string().min(1),
    provider: z.enum(['codex', 'claude']).optional(),
  })
  .strict();

const skillsListParamsSchema = z
  .object({
    cwd: z.string().min(1).optional(),
    cwds: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict();

function normalizeObjectAliases(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }

  return { ...(input as Record<string, unknown>) };
}

function readAliasedField(
  source: Record<string, unknown>,
  canonicalKey: string,
  snakeKey: string,
): unknown {
  const camel = source[canonicalKey];
  const snake = source[snakeKey];

  if (camel !== undefined && snake !== undefined && camel !== snake) {
    throw new Error(`Invalid params: conflicting aliases for ${canonicalKey}`);
  }

  return camel ?? snake;
}

export function parseThreadStartParams(input: unknown): ThreadStartParams {
  const source = normalizeObjectAliases(input);

  const normalized = {
    title: source.title,
    tags: source.tags,
  };

  return threadStartParamsSchema.parse(normalized) as ThreadStartParams;
}

export function parseThreadListParams(input: unknown): ThreadListParams {
  const source = normalizeObjectAliases(input);

  const normalized = {
    tag: source.tag,
  };

  return threadListParamsSchema.parse(normalized) as ThreadListParams;
}

export function parseThreadReadParams(input: unknown): ThreadReadParams {
  const source = normalizeObjectAliases(input);

  const normalized = {
    threadId: readAliasedField(source, 'threadId', 'thread_id'),
  };

  return threadReadParamsSchema.parse(normalized) as ThreadReadParams;
}

export function parseTurnStartParams(input: unknown): TurnStartParams {
  const source = normalizeObjectAliases(input);

  const normalized = {
    threadId: readAliasedField(source, 'threadId', 'thread_id'),
    input: source.input,
    provider: source.provider,
  };

  return turnStartParamsSchema.parse(normalized) as TurnStartParams;
}

export function parseSkillsListParams(input: unknown): SkillsListParams {
  const source = normalizeObjectAliases(input);

  const normalized = {
    cwd: readAliasedField(source, 'cwd', 'working_directory'),
    cwds: source.cwds,
  };

  return skillsListParamsSchema.parse(normalized) as SkillsListParams;
}

export function parseJsonRpcRequest(input: unknown): JsonRpcRequest {
  return requestSchema.parse(input) as JsonRpcRequest;
}

export function parseJsonRpcNotification(input: unknown): JsonRpcNotification {
  return notificationSchema.parse(input) as JsonRpcNotification;
}

export function parseJsonRpcMessage(input: unknown): ParsedJsonRpcMessage {
  const parsed = messageSchema.parse(input);

  if ('id' in parsed) {
    return {
      kind: 'request',
      value: parsed as JsonRpcRequest,
    };
  }

  return {
    kind: 'notification',
    value: parsed as JsonRpcNotification,
  };
}

export function parseJsonRpcResponse(input: unknown): JsonRpcResponse {
  return responseSchema.parse(input) as JsonRpcResponse;
}

export function buildInvalidRequestError(id: JsonRpcErrorResponse['id'], data?: unknown): JsonRpcErrorResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code: -32600,
      message: 'Invalid Request',
      data,
    },
  };
}
