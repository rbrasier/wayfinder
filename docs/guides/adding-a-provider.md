# Adding a New LLM Provider

The template ships with three providers wired in: Anthropic (default),
OpenAI, and Mistral. Adding a fourth is a single new file and one registry
entry.

## The provider port

The application code only ever uses `ILanguageModel` from
`@rbrasier/domain`:

```ts
interface ILanguageModel {
  readonly provider: ProviderName;
  generateObject<T>(input): Promise<Result<{ object: T }>>;
  streamText(input): Promise<Result<{ textStream: AsyncIterable<string> }>>;
  streamObject<T>(input): Promise<Result<{ partialObjectStream, object }>>;
}
```

The `LanguageModelAdapter` in `packages/adapters/src/ai/` implements this
once for *all* providers, by delegating to the Vercel AI SDK with a model
chosen at construction time. The provider-specific knowledge lives entirely
in the registry at `packages/adapters/src/ai/providers.ts`.

## Steps to add a provider — example: `groq`

### 1. Install the SDK

```bash
pnpm --filter @rbrasier/adapters add @ai-sdk/groq
```

### 2. Add the provider name to the domain

`packages/domain/src/ports/language-model.ts`:

```ts
export type ProviderName = "anthropic" | "openai" | "mistral" | "groq";
```

### 3. Add it to the registry

`packages/adapters/src/ai/providers.ts`:

```ts
import { groq } from "@ai-sdk/groq";

const PROVIDERS = {
  anthropic: { ... },
  openai:    { ... },
  mistral:   { ... },
  groq: {
    defaultModel: "llama-3.3-70b-versatile",
    resolve: (model: string) => groq(model),
  },
} as const satisfies Record<ProviderName, ProviderEntry>;
```

### 4. Add the env var

`.env.example`:

```bash
GROQ_API_KEY=
```

### 5. Done

That's it. `LanguageModelAdapter` doesn't change. Use cases don't change.
The Langfuse decorator doesn't change. Switch the default with
`AI_DEFAULT_PROVIDER=groq`.

## Why this is so cheap

The ports & adapters boundary means provider differences (auth, base URL,
endpoint shape) are absorbed by the SDK and the registry. The application
layer only ever sees `ILanguageModel`.

## Testing a new provider

Run the `/sample` page locally with `AI_DEFAULT_PROVIDER=<your-provider>`
and confirm the structured output streams in. If `streamObject` is unsupported
by the underlying model, the use case will return an `AI_PROVIDER_FAILED`
error and the UI will surface it via the existing error path — no code
change needed.
