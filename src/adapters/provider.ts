import { spawnSync } from 'node:child_process';
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

export interface CreateProviderAdaptersOptions {
  claudeMode?: 'mock' | 'cli';
  claudePermissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions';
}

function ensureText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function parseJsonLines(payload: string): unknown[] {
  return payload
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return null;
      }
    })
    .filter((item): item is unknown => item !== null);
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
    const topType = ensureText(typed.type);

    if (topType === 'stream_event') {
      const nestedEvent = typed.event;
      if (nestedEvent && typeof nestedEvent === 'object') {
        const streamType = ensureText((nestedEvent as Record<string, unknown>).type);

        if (streamType === 'content_block_delta') {
          const delta = (nestedEvent as Record<string, unknown>).delta;
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

        if (streamType === 'message_stop') {
          events.push(
            createTurnCompletedEvent({
              threadId: context.threadId,
              turnId: context.turnId,
            }),
          );
          continue;
        }
      }
    }

    // Legacy / mock fallback shape support.
    if (topType === 'content_block_delta') {
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

    if (topType === 'message_stop') {
      events.push(
        createTurnCompletedEvent({
          threadId: context.threadId,
          turnId: context.turnId,
        }),
      );
      continue;
    }

    if (topType === 'result') {
      const resultText = ensureText(typed.result);
      if (resultText) {
        events.push(
          createTurnDeltaEvent({
            threadId: context.threadId,
            turnId: context.turnId,
            chunk: resultText,
          }),
        );
      }
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

  constructor(
    private readonly options: {
      mode: 'mock' | 'cli';
      permissionMode: 'default' | 'acceptEdits' | 'bypassPermissions';
    } = {
      mode: 'mock',
      permissionMode: 'acceptEdits',
    },
  ) {}

  public startTurn(input: ProviderTurnStartInput): ProviderTurnStartResult {
    if (this.options.mode === 'mock') {
      const rawStreamEvents = [
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Mock Claude stream: ' } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: input.input } },
        { type: 'message_stop' },
      ];

      return {
        accepted: true,
        providerMessage: 'claude adapter translated stream-json events (mock mode)',
        events: translateClaudeStreamEvents(rawStreamEvents, {
          threadId: input.threadId,
          turnId: input.turnId,
        }),
      };
    }

    const cli = spawnSync(
      'claude',
      [
        '-p',
        input.input,
        '--output-format',
        'stream-json',
        '--include-partial-messages',
        '--verbose',
        '--permission-mode',
        this.options.permissionMode,
      ],
      {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      },
    );

    if (cli.error) {
      return {
        accepted: false,
        providerMessage: `claude adapter failed: ${cli.error.message}`,
        events: [
          createTurnDeltaEvent({
            threadId: input.threadId,
            turnId: input.turnId,
            chunk: `Claude execution error: ${cli.error.message}`,
          }),
          createTurnCompletedEvent({
            threadId: input.threadId,
            turnId: input.turnId,
            stopReason: 'providerError',
          }),
        ],
      };
    }

    const raw = parseJsonLines(cli.stdout ?? '');
    const translated = translateClaudeStreamEvents(raw, {
      threadId: input.threadId,
      turnId: input.turnId,
    });

    return {
      accepted: cli.status === 0,
      providerMessage: cli.status === 0
        ? 'claude adapter translated real CLI stream-json output'
        : `claude exited with status ${cli.status ?? 'unknown'}`,
      events: translated,
    };
  }
}

export function createProviderAdapters(options: CreateProviderAdaptersOptions = {}): Record<'codex' | 'claude', ProviderAdapter> {
  return {
    codex: new CodexProviderAdapter(),
    claude: new ClaudeProviderAdapter({
      mode: options.claudeMode ?? 'mock',
      permissionMode: options.claudePermissionMode ?? 'acceptEdits',
    }),
  };
}
