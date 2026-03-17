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
  tags?: string[];
  cwd?: string;
  provider?: 'codex' | 'claude';
}

export interface ThreadListParams {
  tag?: string;
  provider?: 'codex' | 'claude';
  limit?: number;
  cursor?: string;
}

export interface ThreadReadParams {
  threadId: string;
}

export interface TurnStartParams {
  threadId: string;
  input: string;
  provider?: 'codex' | 'claude';
  model?: ClaudeModelId;
  effort?: ClaudeReasoningEffort;
  cwd?: string;
}

export interface SkillsListParams {
  cwd?: string;
  cwds?: string[];
}

export type ClaudeModelId =
  | 'claude-opus-4-6'
  | 'claude-sonnet-4-6'
  | 'claude-haiku-4-5';

export type ClaudeReasoningEffort = 'low' | 'med' | 'high' | 'max';

export interface ModelListItem {
  id: ClaudeModelId;
  model: ClaudeModelId;
  displayName: string;
  isDefault: boolean;
  supportedReasoningEfforts: ClaudeReasoningEffort[];
  defaultReasoningEffort?: Exclude<ClaudeReasoningEffort, 'max'>;
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
