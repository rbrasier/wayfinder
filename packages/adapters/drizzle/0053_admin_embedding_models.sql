-- data-impact: preserved — 384-dim vectors are zero-padded to 1024; cosine similarity is unchanged, so existing local and OpenAI 3-small embeddings keep matching
-- The HNSW index is dropped and rebuilt around the type change; the added embedding_model
-- columns are nullable and are stamped with the active model on first boot (ADR-017, amended).
DROP INDEX IF EXISTS "kb_document_chunks_embedding_hnsw_idx";--> statement-breakpoint
ALTER TABLE "kb_chunk_versions" ALTER COLUMN "embedding" SET DATA TYPE vector(1024) USING ("embedding"::real[] || array_fill(0::real, ARRAY[1024 - vector_dims("embedding")]))::vector(1024);--> statement-breakpoint
ALTER TABLE "kb_document_chunks" ALTER COLUMN "embedding" SET DATA TYPE vector(1024) USING ("embedding"::real[] || array_fill(0::real, ARRAY[1024 - vector_dims("embedding")]))::vector(1024);--> statement-breakpoint
ALTER TABLE "kb_chunk_versions" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "kb_document_chunks" ADD COLUMN "embedding_model" text;--> statement-breakpoint
CREATE INDEX "kb_document_chunks_embedding_model_idx" ON "kb_document_chunks" USING btree ("embedding_model");--> statement-breakpoint
CREATE INDEX "kb_document_chunks_embedding_hnsw_idx" ON "kb_document_chunks" USING hnsw ("embedding" vector_cosine_ops) WITH (m=16,ef_construction=64);
