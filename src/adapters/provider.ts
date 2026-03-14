export interface ProviderTurnStartInput {
  threadId: string;
  turnId: string;
  input: string;
}

export interface ProviderTurnStartResult {
  accepted: boolean;
  providerMessage: string;
}

export interface ProviderAdapter {
  readonly name: 'codex' | 'claude';
  startTurn(input: ProviderTurnStartInput): Promise<ProviderTurnStartResult>;
}

export class CodexProviderAdapter implements ProviderAdapter {
  public readonly name = 'codex' as const;

  public async startTurn(_input: ProviderTurnStartInput): Promise<ProviderTurnStartResult> {
    return {
      accepted: true,
      providerMessage: 'codex adapter stub accepted turn',
    };
  }
}

export class ClaudeProviderAdapter implements ProviderAdapter {
  public readonly name = 'claude' as const;

  public async startTurn(_input: ProviderTurnStartInput): Promise<ProviderTurnStartResult> {
    return {
      accepted: true,
      providerMessage: 'claude adapter stub accepted turn',
    };
  }
}

export function createProviderAdapters(): Record<'codex' | 'claude', ProviderAdapter> {
  return {
    codex: new CodexProviderAdapter(),
    claude: new ClaudeProviderAdapter(),
  };
}
