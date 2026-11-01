import { createRequire } from "node:module";
import { domainError, err, ok, type Result } from "@wayfinder/domain";

// Whether this artefact can run the local provider at all. A Lambda zip ships
// without onnxruntime-node so that cold starts stay sane (ADR-056 §4), which
// makes availability a property of the build rather than of configuration.
// Resolution, not execution: the pipeline itself stays behind the lazy import
// below, and the native runtime is checked because it is the half that is
// actually dropped. Never sniff the platform — a container built without the
// embeddings path is the same fact arrived at differently.
//
// The native runtime is resolved from transformers' own location, not from
// here: it is transformers' dependency, and pnpm links only a package's direct
// dependencies beside it. Resolving it from adapters succeeded only when
// NODE_PATH happened to reach pnpm's hidden hoist directory.
const requireFromAdapters = createRequire(import.meta.url);

// Returns the resolved file path; `fromPath` defaults to this module.
export type ModuleResolver = (specifier: string, fromPath?: string) => string;

const resolveModule: ModuleResolver = (specifier, fromPath) => {
  if (fromPath === undefined) return requireFromAdapters.resolve(specifier);
  return createRequire(fromPath).resolve(specifier);
};

export const isLocalEmbeddingsAvailable = (resolve: ModuleResolver = resolveModule): boolean => {
  try {
    const transformersEntry = resolve("@huggingface/transformers", undefined);
    resolve("onnxruntime-node", transformersEntry);
    return true;
  } catch {
    return false;
  }
};

export interface FeatureExtractionOptions {
  pooling: "mean";
  normalize: true;
}

// Minimal shape of a transformers.js feature-extraction pipeline call: returns a
// Tensor whose `data` is the (mean-pooled, normalised) embedding.
export type FeatureExtractor = (
  text: string,
  options: FeatureExtractionOptions,
) => Promise<{ data: ArrayLike<number> }>;

export type FeatureExtractorFactory = (model: string) => Promise<FeatureExtractor>;

export interface LocalModelEnvOptions {
  // Air-gapped deploys bake the model into the image and disable remote fetches.
  allowRemoteModels?: boolean;
  localModelPath?: string;
  cacheDir?: string;
}

// Loads the transformers.js pipeline lazily via dynamic import so onnxruntime is
// pulled in only when the local provider is actually used, and never during a
// test that injects a fake factory.
export const createTransformersExtractorFactory = (
  envOptions: LocalModelEnvOptions = {},
): FeatureExtractorFactory => {
  return async (model: string) => {
    const { pipeline, env } = await import("@huggingface/transformers");
    if (envOptions.allowRemoteModels !== undefined) env.allowRemoteModels = envOptions.allowRemoteModels;
    if (envOptions.localModelPath !== undefined) env.localModelPath = envOptions.localModelPath;
    if (envOptions.cacheDir !== undefined) env.cacheDir = envOptions.cacheDir;
    const extractor = await pipeline("feature-extraction", model);
    return (text, options) => extractor(text, options) as Promise<{ data: ArrayLike<number> }>;
  };
};

// In-process embeddings (ADR-017) — no external API, works air-gapped. The
// pipeline is built once on first use and reused.
export class LocalEmbeddingsAdapter {
  private extractor: Promise<FeatureExtractor> | null = null;

  constructor(
    private readonly model: string,
    private readonly createExtractor: FeatureExtractorFactory,
  ) {}

  private loadExtractor(): Promise<FeatureExtractor> {
    if (!this.extractor) this.extractor = this.createExtractor(this.model);
    return this.extractor;
  }

  async embed(text: string): Promise<Result<number[]>> {
    try {
      const extractor = await this.loadExtractor();
      const output = await extractor(text, { pooling: "mean", normalize: true });
      return ok(Array.from(output.data));
    } catch (cause) {
      // A failed model load must not poison the singleton — let the next call retry.
      this.extractor = null;
      return err(domainError("AI_PROVIDER_FAILED", "Local embedding generation failed.", cause));
    }
  }
}
