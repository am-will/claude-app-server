import { describe, expect, it } from 'vitest';
import {
  parseJsonRpcMessage,
  parseJsonRpcRequest,
  responseSchema,
} from '../src/protocol/schemas.js';

describe('protocol schemas', () => {
  it('parses valid request payload', () => {
    const parsed = parseJsonRpcRequest({
      jsonrpc: '2.0',
      id: 'req-1',
      method: 'session.initialize',
      params: {
        clientName: 'tester',
      },
    });

    expect(parsed.method).toBe('session.initialize');
    expect(parsed.params).toEqual({ clientName: 'tester' });
  });

  it('rejects snake_case method names', () => {
    expect(() =>
      parseJsonRpcRequest({
        jsonrpc: '2.0',
        id: 'req-2',
        method: 'session_initialize',
      }),
    ).toThrow(/camelCase/i);
  });

  it('parses request and notification envelopes', () => {
    const request = parseJsonRpcMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'capability.list',
    });

    const notification = parseJsonRpcMessage({
      jsonrpc: '2.0',
      method: 'thread.start',
      params: { title: 'hello' },
    });

    expect(request.kind).toBe('request');
    expect(notification.kind).toBe('notification');
  });

  it('accepts canonical response shape', () => {
    const parsed = responseSchema.parse({
      jsonrpc: '2.0',
      id: 'id-1',
      result: {
        sessionId: 'sess-1',
        serverVersion: '0.1.0',
      },
    });

    expect(parsed.jsonrpc).toBe('2.0');
  });
});
