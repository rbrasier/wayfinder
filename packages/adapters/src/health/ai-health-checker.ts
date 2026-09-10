import type { AiStatus } from "@wayfinder/domain";

interface AiHealthConfig {
  readonly provider: string;
  readonly anthropicKey?: string;
  readonly openaiKey?: string;
  readonly mistralKey?: string;
  readonly bedrockRegion?: string;
  readonly bedrockAccessKeyId?: string;
  readonly bedrockSecretAccessKey?: string;
}

export class AiHealthChecker {
  constructor(private readonly config: AiHealthConfig) {}

  check(): AiStatus {
    const { provider } = this.config;
    const keyConfigured = this.isConfigured(provider);
    return {
      ok: keyConfigured,
      provider,
      keyConfigured,
      ...(!keyConfigured && { error: `No API key configured for provider '${provider}'` }),
    };
  }

  private isConfigured(provider: string): boolean {
    if (provider === "bedrock") {
      return Boolean(
        this.config.bedrockRegion &&
          this.config.bedrockAccessKeyId &&
          this.config.bedrockSecretAccessKey,
      );
    }
    const keyMap: Record<string, string | undefined> = {
      anthropic: this.config.anthropicKey,
      openai: this.config.openaiKey,
      mistral: this.config.mistralKey,
    };
    return Boolean(keyMap[provider]);
  }
}
