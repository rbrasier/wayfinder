import { createEmbeddingsProvider } from "@wayfinder/adapters";
import type { AiConfig, EmbeddingsConfig, IDocumentChunkRepository, IEmbeddingsProvider } from "@wayfinder/domain";
import { embeddingsModelKey } from "@wayfinder/shared";
import type { ServerEnv } from "./env";

interface EmbeddingsRuntimeConfig {
  getEmbeddingsConfig(): Promise<EmbeddingsConfig>;
  getAiConfig(): Promise<AiConfig>;
}

interface EmbeddingsWiringDeps {
  env: ServerEnv;
  runtimeConfig: EmbeddingsRuntimeConfig;
  documentChunks: Pick<IDocumentChunkRepository, "labelUnlabelledEmbeddings">;
  logger: { warn: (message: string, context?: Record<string, unknown>) => void };
}

const LABEL_FAILED_MESSAGE = "Labelling legacy chunk embeddings failed — will retry on next server start";

// Embeddings share the language models' keys (AiConfig.apiKeys, env-backed), so
// a key saved under AI provider reaches both (ADR-017, as amended).
export const buildEmbeddings = ({
  env,
  runtimeConfig,
  documentChunks,
  logger,
}: EmbeddingsWiringDeps): IEmbeddingsProvider => {
  const embeddings = createEmbeddingsProvider(() => runtimeConfig.getEmbeddingsConfig(), {
    getAiConfig: () => runtimeConfig.getAiConfig(),
    localEnvOptions: {
      allowRemoteModels: env.EMBEDDINGS_ALLOW_REMOTE_MODELS === "false" ? false : undefined,
      localModelPath: env.EMBEDDINGS_LOCAL_MODEL_PATH,
      cacheDir: env.EMBEDDINGS_CACHE_DIR,
    },
  });

  // Chunks written before embedding_model existed were all produced by the model
  // active now — switching needed a re-index, and the switch UI ships with the
  // label — so they are stamped with it once, here, where the env default is
  // visible. Idempotent: labelled rows are never touched.
  void (async () => {
    const modelKey = embeddingsModelKey(await runtimeConfig.getEmbeddingsConfig());
    const labelled = await documentChunks.labelUnlabelledEmbeddings(modelKey);
    if (labelled.error) logger.warn(LABEL_FAILED_MESSAGE, { error: labelled.error });
  })().catch((error: unknown) => {
    logger.warn(LABEL_FAILED_MESSAGE, { error });
  });

  return embeddings;
};
