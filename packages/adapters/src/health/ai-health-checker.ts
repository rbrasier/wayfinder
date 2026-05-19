import type { AiStatus } from "@rbrasier/domain";

interface AiHealthConfig {
  readonly provider: string;
  readonly anthropicKey?: string;
  readonly openaiKey?: string;
  readonly mistralKey?: string;
}

export class AiHealthChecker {
  constructor(private readonly config: AiHealthConfig) {}

  check(): AiStatus {
    const { provider, anthropicKey, openaiKey, mistralKey } = this.config;
    const keyMap: Record<string, string | undefined> = {
      anthropic: anthropicKey,
      openai: openaiKey,
      mistral: mistralKey,
    };
    const keyConfigured = Boolean(keyMap[provider]);
    return {
      ok: keyConfigured,
      provider,
      keyConfigured,
      ...(!keyConfigured && { error: `No API key configured for provider '${provider}'` }),
    };
  }
}
