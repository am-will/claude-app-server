export type JsonRpcVersion = '2.0';

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest<TMethod extends string = string, TParams = unknown> {
  jsonrpc: JsonRpcVersion;
  id: JsonRpcId;
  method: TMethod;
  params?: TParams;
}

export interface JsonRpcNotification<TMethod extends string = string, TParams = unknown> {
  jsonrpc: JsonRpcVersion;
  method: TMethod;
  params?: TParams;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcSuccessResponse<TResult = unknown> {
  jsonrpc: JsonRpcVersion;
  id: JsonRpcId;
  result: TResult;
}

export interface JsonRpcErrorResponse {
  jsonrpc: JsonRpcVersion;
  id: JsonRpcId;
  error: JsonRpcError;
}

export type JsonRpcResponse<TResult = unknown> =
  | JsonRpcSuccessResponse<TResult>
  | JsonRpcErrorResponse;

export interface ServerEvent<TParams extends Record<string, unknown> = Record<string, unknown>> {
  jsonrpc: JsonRpcVersion;
  method: `event.${string}`;
  params: TParams;
}

export interface SessionInitializeParams {
  clientName?: string;
  clientVersion?: string;
}

export interface ThreadStartParams {
  title?: string;
}

export interface TurnStartParams {
  threadId: string;
  input: string;
  provider?: 'codex' | 'claude';
}

export interface ParsedRequest {
  kind: 'request';
  value: JsonRpcRequest;
}

export interface ParsedNotification {
  kind: 'notification';
  value: JsonRpcNotification;
}

export type ParsedJsonRpcMessage = ParsedRequest | ParsedNotification;
