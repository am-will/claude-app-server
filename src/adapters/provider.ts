import type { ServerEvent } from '../protocol/types.js';
import { createTurnCompletedEvent, createTurnDeltaEvent } from '../server/events.js';

export interface ProviderTurnStartInput {
  threadId: string;
  turnId: string;
  input: string;
}

export interface ProviderTurnStartResult {
  accepted: boolean;
  providerMessage: string;
  events: ServerEvent[];
}

export interface ProviderAdapter {
  readonly name: 'codex' | 'claude';
  startTurn(input: ProviderTurnStartInput): ProviderTurnStartResult;
}

function ensureText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function translateClaudeStreamEvents(
  streamEvents: unknown[],
  context: { threadId: string; turnId: string },
): ServerEvent[] {
  const events: ServerEvent[] = [];

  for (const event of streamEvents) {
    if (!event || typeof event !== 'object') {
      continue;
    }

    const typed = event as Record<string, unknown>;
    const type = ensureText(typed.type);

    if (type === 'content_block_delta') {
      const delta = typed.delta;
      if (delta && typeof delta === 'object') {
        const text = ensureText((delta as Record<string, unknown>).text);
        if (text) {
          events.push(
            createTurnDeltaEvent({
              threadId: context.threadId,
              turnId: context.turnId,
              chunk: text,
            }),
          );
        }
      }
      continue;
    }

    if (type === 'message_stop') {
      events.push(
        createTurnCompletedEvent({
          threadId: context.threadId,
          turnId: context.turnId,
        }),
      );
    }
  }

  return events;
}

export class CodexProviderAdapter implements ProviderAdapter {
  public readonly name = 'codex' as const;

  public startTurn(input: ProviderTurnStartInput): ProviderTurnStartResult {
    return {
      accepted: true,
      providerMessage: 'codex adapter accepted turn',
      events: [
        createTurnDeltaEvent({
          threadId: input.threadId,
          turnId: input.turnId,
          chunk: `Codex received: ${input.input}`,
        }),
        createTurnCompletedEvent({
          threadId: input.threadId,
          turnId: input.turnId,
        }),
      ],
    };
  }
}

export class ClaudeProviderAdapter implements ProviderAdapter {
  public readonly name = 'claude' as const;

  public startTurn(input: ProviderTurnStartInput): ProviderTurnStartResult {
    const rawStreamEvents = [
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Mock Claude stream: ' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: input.input } },
      { type: 'message_stop' },
    ];

    return {
      accepted: true,
      providerMessage: 'claude adapter translated stream-json events',
      events: translateClaudeStreamEvents(rawStreamEvents, {
        threadId: input.threadId,
        turnId: input.turnId,
      }),
    };
  }
}

export function createProviderAdapters(): Record<'codex' | 'claude', ProviderAdapter> {
  return {
    codex: new CodexProviderAdapter(),
    claude: new ClaudeProviderAdapter(),
  };
}
