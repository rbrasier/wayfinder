-- ADR-017: standardise embeddings on 384 dimensions (was 1536).
-- The HNSW index is dimension-bound and 1536-d rows cannot cast to 384, so we
-- drop the index, clear incompatible chunks, alter the column, and recreate the
-- index. No production chunks exist yet; any pre-existing rows were embedded with
-- a model whose vectors are not comparable to the new ones, so re-indexing from
-- the stored extracted_text is required regardless.
DROP INDEX IF EXISTS "kb_document_chunks_embedding_hnsw_idx";--> statement-breakpoint
TRUNCATE TABLE "kb_document_chunks";--> statement-breakpoint
ALTER TABLE "kb_document_chunks" ALTER COLUMN "embedding" SET DATA TYPE vector(384);--> statement-breakpoint
CREATE INDEX "kb_document_chunks_embedding_hnsw_idx" ON "kb_document_chunks" USING hnsw ("embedding" vector_cosine_ops) WITH (m=16,ef_construction=64);
