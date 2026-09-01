import {
  domainError,
  err,
  ok,
  type CalledModel,
  type GenerateObjectInput,
  type GenerateTextInput,
  type ILanguageModel,
  type ProviderName,
  type Result,
  type StreamObjectInput,
  type StreamTextInput,
  type TokenUsage,
} from "@rbrasier/domain";

/**
 * A language model that answers from a script instead of a provider.
 *
 * The E2E suite already mocks AI at the browser, but that intercept is
 * `page.route` — it cannot see the calls the Next.js server makes, which is
 * where every turn, branch choice and document-generation judgement actually
 * happens. Specs asserting on that server-side behaviour had no way to control
 * it, so they were parked behind env vars CI never sets.
 *
 * Wired in `apps/web/src/lib/container.ts` under TEST_AUTH_BYPASS only, inside
 * the same quota/usage/tracing decorator chain as the real adapter, so the
 * governance paths stay under test rather than being bypassed along with the
 * provider.
 */

// The port types `schema` as `unknown`, and walking `_def` structurally keeps
// this free of a zod import: the stub then survives a zod major that reshapes
// the public API without touching `_def`, and cannot drift from the zod version
// the app resolves at runtime.
interface ZodLike {
  readonly _def: { readonly typeName: string; readonly [key: string]: unknown };
  parse(value: unknown): unknown;
}

const isZodLike = (value: unknown): value is ZodLike =>
  typeof value === "object" &&
  value !== null &&
  "_def" in value &&
  typeof (value as ZodLike)._def?.typeName === "string";

interface NumberCheck {
  readonly kind: string;
  readonly value?: number;
}

// Sits in the upper half of any declared range. The gates these specs exercise
// compare a confidence against a threshold, so a default at the floor would
// park every gated session and a default at the ceiling would wave everything
// through; neither is a neutral starting point.
const numberWithinRange = (checks: readonly NumberCheck[]): number => {
  const min = checks.find((check) => check.kind === "min")?.value;
  const max = checks.find((check) => check.kind === "max")?.value;
  const isInt = checks.some((check) => check.kind === "int");
  if (min === undefined && max === undefined) return 1;
  const low = min ?? 0;
  const high = max ?? low + 100;
  const chosen = low + (high - low) * 0.75;
  return isInt ? Math.round(chosen) : chosen;
};

/**
 * Builds the smallest value the given schema accepts.
 *
 * Exported for its own tests: a wrong default here surfaces as an unrelated
 * failure deep in the turn pipeline, so it is worth pinning directly.
 */
export const defaultForSchema = (schema: unknown): unknown => {
  if (!isZodLike(schema)) return {};
  const def = schema._def;

  switch (def.typeName) {
    case "ZodObject": {
      const shape = (def.shape as () => Record<string, unknown>)();
      const value: Record<string, unknown> = {};
      for (const [key, field] of Object.entries(shape)) {
        // An absent optional is what a real model returns when it has nothing
        // to say for the field, and `undefined` would serialise differently.
        if (isZodLike(field) && field._def.typeName === "ZodOptional") continue;
        value[key] = defaultForSchema(field);
      }
      return value;
    }
    case "ZodArray":
      return [];
    case "ZodString":
      return "";
    case "ZodNumber":
      return numberWithinRange((def.checks as NumberCheck[] | undefined) ?? []);
    case "ZodBoolean":
      return false;
    case "ZodNull":
      return null;
    case "ZodEnum":
      return (def.values as readonly string[])[0];
    case "ZodLiteral":
      return def.value;
    case "ZodNullable":
      return null;
    case "ZodOptional":
      return defaultForSchema(def.innerType);
    case "ZodDefault":
      return (def.defaultValue as () => unknown)();
    case "ZodUnion":
      return defaultForSchema((def.options as readonly unknown[])[0]);
    case "ZodRecord":
      return {};
    default:
      return {};
  }
};

export interface ScriptedResponse {
  /** Matches only calls made for this purpose. Unset matches any purpose. */
  readonly purpose?: string;
  /** Returned by generateObject/streamObject, after the schema has accepted it. */
  readonly object?: Record<string, unknown>;
  /** Returned by generateText/streamText. */
  readonly text?: string;
  /** Fails the call with this message instead of answering. */
  readonly failWith?: string;
}

const DEFAULT_TEXT = "Scripted response.";

// Roughly a sentence per chunk, so partialObjectStream behaves like a real
// stream: stream-turn.ts writes the delta between partials, and a single-chunk
// stream would make the typing indicator and incremental render untestable.
const STREAM_CHUNK_SIZE = 24;

const usageFor = (text: string): TokenUsage => ({
  promptTokens: 128,
  completionTokens: Math.max(1, Math.ceil(text.length / 4)),
  systemTokens: 32,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});

interface ScriptCall {
  readonly purpose: string;
  readonly sessionId?: string | null;
}

// No provider was called, so no real model name would be honest. The caller's
// own override is reported when it gave one; otherwise this marker keeps E2E
// usage rows distinguishable from billed traffic.
const SCRIPTED_MODEL = "scripted-model";

export class ScriptedLanguageModel implements ILanguageModel {
  readonly provider: ProviderName = "anthropic";

  private readonly scripts = new Map<string, ScriptedResponse[]>();
  private readonly consumed = new Map<string, number>();
  private readonly requested = new Map<string, string[]>();

  /** Replaces any script already held for the session. */
  script(sessionId: string, responses: ScriptedResponse[]): void {
    this.scripts.set(sessionId, responses);
    this.consumed.set(sessionId, 0);
    this.requested.set(sessionId, []);
  }

  /**
   * Every purpose this session has actually been called with.
   *
   * A `purpose` that matches nothing fails silently — the stub falls back to a
   * schema-shaped default and the reply comes back empty, with no error
   * anywhere. Comparing what a spec scripted against what the app asked for is
   * the quickest way to see that, so the route exposes it.
   */
  requestedPurposes(sessionId: string): string[] {
    return this.requested.get(sessionId) ?? [];
  }

  scriptedPurposes(sessionId: string): (string | null)[] {
    return (this.scripts.get(sessionId) ?? []).map((entry) => entry.purpose ?? null);
  }

  /** Clears one session's script, or every session's when called with no id. */
  clear(sessionId?: string): void {
    if (!sessionId) {
      this.scripts.clear();
      this.consumed.clear();
      this.requested.clear();
      return;
    }
    this.scripts.delete(sessionId);
    this.consumed.delete(sessionId);
    this.requested.delete(sessionId);
  }

  private called(model: string | undefined): CalledModel {
    return { provider: this.provider, model: model ?? SCRIPTED_MODEL };
  }

  async generateObject<T>(
    input: GenerateObjectInput,
  ): Promise<Result<{ object: T; usage: TokenUsage } & CalledModel>> {
    const resolved = this.resolveObject(input, input.schema);
    if (resolved.error) return err(resolved.error);
    return ok({
      object: resolved.data as T,
      ...this.called(input.model),
      usage: usageFor(JSON.stringify(resolved.data)),
    });
  }

  async generateText(
    input: GenerateTextInput,
  ): Promise<Result<{ text: string; usage: TokenUsage } & CalledModel>> {
    const entry = this.next(input);
    if (entry?.failWith) return err(providerFailure(entry.failWith));
    const text = entry?.text ?? DEFAULT_TEXT;
    return ok({ text, ...this.called(input.model), usage: usageFor(text) });
  }

  async streamText(
    input: StreamTextInput,
  ): Promise<
    Result<{ textStream: AsyncIterable<string>; usage: Promise<TokenUsage> } & CalledModel>
  > {
    const entry = this.next(input);
    if (entry?.failWith) return err(providerFailure(entry.failWith));
    const text = entry?.text ?? DEFAULT_TEXT;
    return ok({
      textStream: chunksOf(text),
      ...this.called(input.model),
      usage: Promise.resolve(usageFor(text)),
    });
  }

  async streamObject<T>(input: StreamObjectInput): Promise<
    Result<
      {
        partialObjectStream: AsyncIterable<Partial<T>>;
        object: Promise<T>;
        usage: Promise<TokenUsage>;
      } & CalledModel
    >
  > {
    const resolved = this.resolveObject(input, input.schema);
    if (resolved.error) {
      // A real stream surfaces provider errors through onError as well as the
      // Result, and stream-turn.ts rethrows whatever onError captured.
      input.onError?.({ error: new Error(resolved.error.message) });
      return err(resolved.error);
    }

    const object = resolved.data as Record<string, unknown>;
    const response = typeof object.response === "string" ? object.response : "";

    return ok({
      partialObjectStream: growingPartials<T>(object, response),
      object: Promise.resolve(object as T),
      ...this.called(input.model),
      usage: Promise.resolve(usageFor(JSON.stringify(object))),
    });
  }

  private resolveObject(call: ScriptCall, schema: unknown): Result<unknown> {
    const entry = this.next(call);
    if (entry?.failWith) return err(providerFailure(entry.failWith));
    if (!entry?.object) return ok(defaultForSchema(schema));

    // Merge over the default so a script may set only the fields under test and
    // still satisfy a schema that requires the rest.
    const merged = { ...(defaultForSchema(schema) as Record<string, unknown>), ...entry.object };
    if (!isZodLike(schema)) return ok(merged);

    try {
      return ok(schema.parse(merged));
    } catch (cause) {
      return err(
        domainError(
          "VALIDATION_FAILED",
          `Scripted AI response for purpose "${call.purpose}" does not match the schema the caller passed.`,
          cause,
        ),
      );
    }
  }

  private next(call: ScriptCall): ScriptedResponse | null {
    if (!call.sessionId) return null;
    this.requested.get(call.sessionId)?.push(call.purpose);

    const entries = this.scripts.get(call.sessionId);
    if (!entries?.length) return null;

    const matching = entries.filter(
      (entry) => entry.purpose === undefined || entry.purpose === call.purpose,
    );
    if (!matching.length) return null;

    const index = this.consumed.get(call.sessionId) ?? 0;
    this.consumed.set(call.sessionId, index + 1);
    // The last entry repeats: a spec scripting two turns should not have an
    // incidental third call fall back to a default that contradicts them.
    return matching[Math.min(index, matching.length - 1)] ?? null;
  }
}

const providerFailure = (message: string) =>
  domainError("AI_PROVIDER_FAILED", `Scripted AI failure: ${message}`);

async function* chunksOf(text: string): AsyncIterable<string> {
  for (let start = 0; start < text.length; start += STREAM_CHUNK_SIZE) {
    yield text.slice(start, start + STREAM_CHUNK_SIZE);
  }
}

async function* growingPartials<T>(
  object: Record<string, unknown>,
  response: string,
): AsyncIterable<Partial<T>> {
  for (let end = 0; end < response.length; end += STREAM_CHUNK_SIZE) {
    const partial = { ...object, response: response.slice(0, end + STREAM_CHUNK_SIZE) };
    yield partial as unknown as Partial<T>;
  }
  yield object as unknown as Partial<T>;
}
