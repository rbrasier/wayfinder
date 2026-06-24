import { domainError, err, ok } from "@rbrasier/domain";
import type {
  DocumentChunkSearch,
  IDocumentChunkRepository,
  NewDocumentChunk,
  Result,
  RetrievedChunk,
} from "@rbrasier/domain";
import { and, cosineDistance, desc, eq, gte, inArray, or, sql, type SQL } from "drizzle-orm";
import type { Database } from "../db/client";
import { kb_document_chunks } from "../db/schema/wayfinder";
import { logRepoError } from "./log-repo-error";

const FLOW_SCOPED_SOURCES = ["flow_context_doc", "template"] as const;

export class DrizzleDocumentChunksRepository implements IDocumentChunkRepository {
  constructor(private readonly db: Database) {}

  async insertMany(chunks: NewDocumentChunk[]): Promise<Result<void>> {
    if (chunks.length === 0) return ok(undefined);
    try {
      await this.db.insert(kb_document_chunks).values(
        chunks.map((chunk) => ({
          flow_id: chunk.flowId,
          session_id: chunk.sessionId,
          source_type: chunk.sourceType,
          storage_path: chunk.storagePath,
          filename: chunk.filename,
          chunk_index: chunk.chunkIndex,
          chunk_text: chunk.chunkText,
          embedding: chunk.embedding,
        })),
      );
      return ok(undefined);
    } catch (cause) {
      logRepoError("DrizzleDocumentChunksRepository.insertMany", cause);
      return err(domainError("INFRA_FAILURE", "Failed to insert document chunks.", cause));
    }
  }

  async deleteByStoragePath(storagePath: string): Promise<Result<void>> {
    try {
      await this.db
        .delete(kb_document_chunks)
        .where(eq(kb_document_chunks.storage_path, storagePath));
      return ok(undefined);
    } catch (cause) {
      logRepoError("DrizzleDocumentChunksRepository.deleteByStoragePath", cause);
      return err(domainError("INFRA_FAILURE", "Failed to delete document chunks.", cause));
    }
  }

  async search(input: DocumentChunkSearch): Promise<Result<RetrievedChunk[]>> {
    const scopes: SQL[] = [];
    if (input.flowId) {
      scopes.push(
        and(
          eq(kb_document_chunks.flow_id, input.flowId),
          inArray(kb_document_chunks.source_type, [...FLOW_SCOPED_SOURCES]),
        )!,
      );
    }
    if (input.sessionId) {
      scopes.push(
        and(
          eq(kb_document_chunks.session_id, input.sessionId),
          eq(kb_document_chunks.source_type, "session_upload"),
        )!,
      );
    }
    if (scopes.length === 0) return ok([]);

    try {
      const similarity = sql<number>`1 - (${cosineDistance(kb_document_chunks.embedding, input.embedding)})`;
      const rows = await this.db
        .select({
          id: kb_document_chunks.id,
          filename: kb_document_chunks.filename,
          chunkIndex: kb_document_chunks.chunk_index,
          chunkText: kb_document_chunks.chunk_text,
          sourceType: kb_document_chunks.source_type,
          similarity,
        })
        .from(kb_document_chunks)
        .where(
          and(
            or(...scopes),
            // Curation lifecycle (ADR-028): archived/draft chunks are never retrieved.
            eq(kb_document_chunks.status, "active"),
            gte(similarity, input.minSimilarity),
          ),
        )
        .orderBy(desc(similarity))
        .limit(input.limit);

      // Fire-and-forget: usage counters are non-critical analytics and must not
      // add latency to the inference hot path. bumpUsage swallows its own errors,
      // so the floating promise can never reject.
      void this.bumpUsage(rows.map((row) => row.id));

      return ok(
        rows.map(({ id: _id, ...row }) => ({ ...row, similarity: Number(row.similarity) })),
      );
    } catch (cause) {
      logRepoError("DrizzleDocumentChunksRepository.search", cause);
      return err(domainError("INFRA_FAILURE", "Failed to search document chunks.", cause));
    }
  }

  // Usage metrics for the curation surface (ADR-028). A failed counter write must
  // never break retrieval, so it is logged and swallowed rather than propagated.
  private async bumpUsage(chunkIds: string[]): Promise<void> {
    if (chunkIds.length === 0) return;
    try {
      await this.db
        .update(kb_document_chunks)
        .set({
          retrieval_count: sql`${kb_document_chunks.retrieval_count} + 1`,
          last_retrieved_at: new Date(),
        })
        .where(inArray(kb_document_chunks.id, chunkIds));
    } catch (cause) {
      logRepoError("DrizzleDocumentChunksRepository.bumpUsage", cause);
    }
  }
}
