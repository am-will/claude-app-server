import type { ServerEvent } from '../protocol/types.js';

function ensureCamelCaseKeys(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      ensureCamelCaseKeys(item);
    }
    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (key.includes('_')) {
      throw new Error(`Non-canonical snake_case key in event payload: ${key}`);
    }
    ensureCamelCaseKeys(nested);
  }
}

export function createEvent<TParams extends Record<string, unknown>>(
  eventName: string,
  params: TParams,
): ServerEvent<TParams & { emittedAt: string }> {
  const normalized = {
    ...params,
    emittedAt: new Date().toISOString(),
  };

  ensureCamelCaseKeys(normalized);

  return {
    jsonrpc: '2.0',
    method: `event.${eventName}`,
    params: normalized,
  };
}

export function createTurnStartedEvent(input: {
  threadId: string;
  turnId: string;
  provider: 'codex' | 'claude';
}): ServerEvent {
  return createEvent('turnStarted', {
    threadId: input.threadId,
    turnId: input.turnId,
    provider: input.provider,
    status: 'started',
  });
}

export function createTurnDeltaEvent(input: {
  threadId: string;
  turnId: string;
  chunk: string;
}): ServerEvent {
  return createEvent('turnDelta', {
    threadId: input.threadId,
    turnId: input.turnId,
    chunk: input.chunk,
  });
}

export function createTurnCompletedEvent(input: {
  threadId: string;
  turnId: string;
  stopReason?: string;
}): ServerEvent {
  return createEvent('turnCompleted', {
    threadId: input.threadId,
    turnId: input.turnId,
    stopReason: input.stopReason ?? 'endTurn',
  });
}
