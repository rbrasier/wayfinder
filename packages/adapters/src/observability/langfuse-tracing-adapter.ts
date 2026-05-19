import type {
  GenerateObjectInput,
  ILanguageModel,
  ProviderName,
  Result,
  StreamObjectInput,
  StreamTextInput,
  TokenUsage,
} from "@rbrasier/domain";
import { Langfuse } from "langfuse";

export interface LangfuseConfig {
  readonly publicKey: string;
  readonly secretKey: string;
  readonly host?: string;
}

/**
 * Decorates an ILanguageModel with Langfuse traces.
 * Only enabled if both keys are present — see `withOptionalLangfuse`.
 */
export class LangfuseTracingAdapter implements ILanguageModel {
  private readonly client: Langfuse;

  constructor(
    private readonly inner: ILanguageModel,
    config: LangfuseConfig,
  ) {
    this.client = new Langfuse({
      publicKey: config.publicKey,
      secretKey: config.secretKey,
      baseUrl: config.host,
    });
  }

  get provider(): ProviderName {
    return this.inner.provider;
  }

  async generateObject<T>(
    input: GenerateObjectInput,
  ): Promise<Result<{ object: T; usage: TokenUsage }>> {
    const trace = this.client.trace({
      name: "generateObject",
      input: { purpose: input.purpose, model: input.model, provider: this.provider },
      userId: input.userId ?? undefined,
    });
    const start = Date.now();
    const result = await this.inner.generateObject<T>(input);
    trace.update({
      output: result.error
        ? { error: result.error.code, message: result.error.message }
        : { ok: true },
      metadata: {
        latencyMs: Date.now() - start,
        provider: this.provider,
        ...(!result.error && { usage: result.data.usage }),
      },
    });
    return result;
  }

  async streamText(
    input: StreamTextInput,
  ): Promise<Result<{ textStream: AsyncIterable<string>; usage: Promise<TokenUsage> }>> {
    const trace = this.client.trace({
      name: "streamText",
      input: { purpose: input.purpose, model: input.model, provider: this.provider },
      userId: input.userId ?? undefined,
    });
    const start = Date.now();
    const result = await this.inner.streamText(input);
    if (!result.error) {
      void result.data.usage.then((usage) => {
        trace.update({
          output: { ok: true },
          metadata: { latencyMs: Date.now() - start, provider: this.provider, usage },
        });
      });
    } else {
      trace.update({
        output: { error: result.error.code, message: result.error.message },
        metadata: { latencyMs: Date.now() - start, provider: this.provider },
      });
    }
    return result;
  }

  async streamObject<T>(
    input: StreamObjectInput,
  ): Promise<
    Result<{
      partialObjectStream: AsyncIterable<Partial<T>>;
      object: Promise<T>;
      usage: Promise<TokenUsage>;
    }>
  > {
    const trace = this.client.trace({
      name: "streamObject",
      input: { purpose: input.purpose, model: input.model, provider: this.provider },
      userId: input.userId ?? undefined,
    });
    const start = Date.now();
    const result = await this.inner.streamObject<T>(input);
    if (!result.error) {
      void result.data.usage.then((usage) => {
        trace.update({
          output: { ok: true },
          metadata: { latencyMs: Date.now() - start, provider: this.provider, usage },
        });
      });
    } else {
      trace.update({
        output: { error: result.error.code, message: result.error.message },
        metadata: { latencyMs: Date.now() - start, provider: this.provider },
      });
    }
    return result;
  }
}

/**
 * Wrap an ILanguageModel with Langfuse only when both keys are configured.
 * Otherwise returns the inner model unchanged — observability is opt-in.
 */
export const withOptionalLangfuse = (
  inner: ILanguageModel,
  env: { LANGFUSE_PUBLIC_KEY?: string; LANGFUSE_SECRET_KEY?: string; LANGFUSE_HOST?: string },
): ILanguageModel => {
  if (!env.LANGFUSE_PUBLIC_KEY || !env.LANGFUSE_SECRET_KEY) return inner;
  return new LangfuseTracingAdapter(inner, {
    publicKey: env.LANGFUSE_PUBLIC_KEY,
    secretKey: env.LANGFUSE_SECRET_KEY,
    host: env.LANGFUSE_HOST,
  });
};
