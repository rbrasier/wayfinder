#!/usr/bin/env node
// Pre-fetches the local embedding model into the transformers.js cache so the
// app can run with no network access (air-gapped deploys). Run this during the
// image build, while the HF hub is still reachable:
//
//   EMBEDDINGS_CACHE_DIR=/app/.embeddings-cache node scripts/fetch-embeddings-model.mjs
//
// Then run the app with the same EMBEDDINGS_CACHE_DIR and
// EMBEDDINGS_ALLOW_REMOTE_MODELS=false so it loads the vendored weights only.
//
// The model id mirrors EMBEDDINGS_DEFAULT_MODELS.local in
// packages/shared/src/schemas/embeddings.ts.

import { env, pipeline } from "@huggingface/transformers";

const MODEL_ID = process.env.EMBEDDINGS_MODEL ?? "onnx-community/all-MiniLM-L6-v2-ONNX";

if (process.env.EMBEDDINGS_CACHE_DIR) {
  env.cacheDir = process.env.EMBEDDINGS_CACHE_DIR;
}

console.log(`Fetching embedding model "${MODEL_ID}" into ${env.cacheDir} …`);
const extractor = await pipeline("feature-extraction", MODEL_ID);
const probe = await extractor("warm up", { pooling: "mean", normalize: true });
console.log(`Done. Vector dimension: ${probe.data.length}`);
