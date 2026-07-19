// Pre-downloads the local embedding model into EMBEDDINGS_CACHE_DIR so CI pays
// the ~90 MB HuggingFace fetch once, in a dedicated step, instead of inside a
// request handler's timeout budget. The app (LocalEmbeddingsAdapter) then loads
// the same on-disk model via env.cacheDir and embeds without a network round-trip.
//
// Model id is kept in sync with EMBEDDINGS_DEFAULT_MODELS.local in
// packages/shared/src/schemas/embeddings.ts.
const MODEL_ID = "onnx-community/all-MiniLM-L6-v2-ONNX";

const { pipeline, env } = await import("@huggingface/transformers");

const cacheDir = process.env.EMBEDDINGS_CACHE_DIR;
if (cacheDir) env.cacheDir = cacheDir;
env.allowRemoteModels = true;

const startedAt = Date.now();
const extractor = await pipeline("feature-extraction", MODEL_ID);
// One real inference so the ONNX weights are materialised and validated, not
// just the config/tokenizer files.
await extractor("warm up", { pooling: "mean", normalize: true });

console.log(
  `Embedding model warmed: ${MODEL_ID} -> ${cacheDir ?? "(default cache)"} in ${(
    (Date.now() - startedAt) / 1000
  ).toFixed(1)}s`,
);
