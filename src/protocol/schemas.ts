import { z } from 'zod';
import type {
  JsonRpcErrorResponse,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
  ParsedJsonRpcMessage,
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
