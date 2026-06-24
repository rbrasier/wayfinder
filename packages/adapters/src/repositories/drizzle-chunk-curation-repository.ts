import { domainError, err, ok } from "@rbrasier/domain";
import type {
  ChunkEdit,
  ChunkListFilter,
  ChunkRevert,
  ChunkStatus,
  ChunkVersion,
  CuratedChunk,
  IChunkCurationRepository,
  Result,
} from "@rbrasier/domain";
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { Database } from "../db/client";
import { kb_chunk_versions, kb_document_chunks } from "../db/schema/wayfinder";
import { logRepoError } from "./log-repo-error";

// The curation surface never needs the embedding or the tsvector, so we never
// select them — they stay in the data layer (ADR-028).
const curatedColumns = {
  id: kb_document_chunks.id,
  flow_id: kb_document_chunks.flow_id,
  session_id: kb_document_chunks.session_id,
  source_type: kb_document_chunks.source_type,
  storage_path: kb_document_chunks.storage_path,
  filename: kb_document_chunks.filename,
  chunk_index: kb_document_chunks.chunk_index,
  chunk_text: kb_document_chunks.chunk_text,
  status: kb_document_chunks.status,
  tags: kb_document_chunks.tags,
  retrieval_count: kb_document_chunks.retrieval_count,
  last_retrieved_at: kb_document_chunks.last_retrieved_at,
  created_at: kb_document_chunks.created_at,
  updated_at: kb_document_chunks.updated_at,
};

type CuratedRow = {
  [Key in keyof typeof curatedColumns]: (typeof kb_document_chunks.$inferSelect)[Key];
};

const toCuratedChunk = (row: CuratedRow): CuratedChunk => ({
  id: row.id,
  flowId: row.flow_id,
  sessionId: row.session_id,
  sourceType: row.source_type,
  storagePath: row.storage_path,
  filename: row.filename,
  chunkIndex: row.chunk_index,
  chunkText: row.chunk_text,
  status: row.status,
  tags: row.tags,
  retrievalCount: row.retrieval_count,
  lastRetrievedAt: row.last_retrieved_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toChunkVersion = (row: typeof kb_chunk_versions.$inferSelect): ChunkVersion => ({
  id: row.id,
  chunkId: row.chunk_id,
  chunkText: row.chunk_text,
  embedding: row.embedding,
  editedBy: row.edited_by,
  reason: row.reason,
  createdAt: row.created_at,
});

export class DrizzleChunkCurationRepository implements IChunkCurationRepository {
  constructor(private readonly db: Database) {}

  async list(filter: ChunkListFilter): Promise<Result<CuratedChunk[]>> {
    const conditions: SQL[] = [];
    if (filter.flowId) conditions.push(eq(kb_document_chunks.flow_id, filter.flowId));
    if (filter.status) conditions.push(eq(kb_document_chunks.status, filter.status));
    if (filter.tag) conditions.push(sql`${kb_document_chunks.tags} @> ARRAY[${filter.tag}]::text[]`);

    try {
      const rows = await this.db
        .select(curatedColumns)
        .from(kb_document_chunks)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(kb_document_chunks.updated_at))
        .limit(filter.limit)
        .offset(filter.offset);
      return ok(rows.map(toCuratedChunk));
    } catch (cause) {
      logRepoError("DrizzleChunkCurationRepository.list", cause);
      return err(domainError("INFRA_FAILURE", "Failed to list chunks.", cause));
    }
  }

  async findById(chunkId: string): Promise<Result<CuratedChunk | null>> {
    try {
      const [row] = await this.db
        .select(curatedColumns)
        .from(kb_document_chunks)
        .where(eq(kb_document_chunks.id, chunkId))
        .limit(1);
      return ok(row ? toCuratedChunk(row) : null);
    } catch (cause) {
      logRepoError("DrizzleChunkCurationRepository.findById", cause);
      return err(domainError("INFRA_FAILURE", "Failed to load chunk.", cause));
    }
  }

  async applyEdit(edit: ChunkEdit): Promise<Result<CuratedChunk>> {
    try {
      const updated = await this.db.transaction(async (tx) => {
        const [current] = await tx
          .select({
            chunk_text: kb_document_chunks.chunk_text,
            embedding: kb_document_chunks.embedding,
          })
          .from(kb_document_chunks)
          .where(eq(kb_document_chunks.id, edit.chunkId))
          .limit(1);
        if (!current) return null;

        await tx.insert(kb_chunk_versions).values({
          chunk_id: edit.chunkId,
          chunk_text: current.chunk_text,
          embedding: current.embedding,
          edited_by: edit.editedBy,
          reason: edit.reason,
        });

        const [row] = await tx
          .update(kb_document_chunks)
          .set({ chunk_text: edit.newText, embedding: edit.newEmbedding, updated_at: new Date() })
          .where(eq(kb_document_chunks.id, edit.chunkId))
          .returning(curatedColumns);
        return row ?? null;
      });

      if (!updated) return err(domainError("NOT_FOUND", "Chunk not found."));
      return ok(toCuratedChunk(updated));
    } catch (cause) {
      logRepoError("DrizzleChunkCurationRepository.applyEdit", cause);
      return err(domainError("INFRA_FAILURE", "Failed to edit chunk.", cause));
    }
  }

  async revert(input: ChunkRevert): Promise<Result<CuratedChunk>> {
    try {
      const restored = await this.db.transaction(async (tx) => {
        const [version] = await tx
          .select({
            chunk_text: kb_chunk_versions.chunk_text,
            embedding: kb_chunk_versions.embedding,
          })
          .from(kb_chunk_versions)
          .where(
            and(eq(kb_chunk_versions.id, input.versionId), eq(kb_chunk_versions.chunk_id, input.chunkId)),
          )
          .limit(1);
        if (!version) return { missing: "version" as const };

        const [current] = await tx
          .select({
            chunk_text: kb_document_chunks.chunk_text,
            embedding: kb_document_chunks.embedding,
          })
          .from(kb_document_chunks)
          .where(eq(kb_document_chunks.id, input.chunkId))
          .limit(1);
        if (!current) return { missing: "chunk" as const };

        // Snapshot the current state so the revert is itself reversible.
        await tx.insert(kb_chunk_versions).values({
          chunk_id: input.chunkId,
          chunk_text: current.chunk_text,
          embedding: current.embedding,
          edited_by: input.editedBy,
          reason: "revert",
        });

        const [row] = await tx
          .update(kb_document_chunks)
          .set({ chunk_text: version.chunk_text, embedding: version.embedding, updated_at: new Date() })
          .where(eq(kb_document_chunks.id, input.chunkId))
          .returning(curatedColumns);
        return { row };
      });

      if ("missing" in restored) {
        return err(domainError("NOT_FOUND", "Chunk or version not found."));
      }
      return ok(toCuratedChunk(restored.row!));
    } catch (cause) {
      logRepoError("DrizzleChunkCurationRepository.revert", cause);
      return err(domainError("INFRA_FAILURE", "Failed to revert chunk.", cause));
    }
  }

  async setStatus(chunkIds: string[], status: ChunkStatus): Promise<Result<void>> {
    if (chunkIds.length === 0) return ok(undefined);
    try {
      await this.db
        .update(kb_document_chunks)
        .set({ status, updated_at: new Date() })
        .where(inArray(kb_document_chunks.id, chunkIds));
      return ok(undefined);
    } catch (cause) {
      logRepoError("DrizzleChunkCurationRepository.setStatus", cause);
      return err(domainError("INFRA_FAILURE", "Failed to update chunk status.", cause));
    }
  }

  async addTag(chunkIds: string[], tag: string): Promise<Result<void>> {
    if (chunkIds.length === 0) return ok(undefined);
    try {
      await this.db
        .update(kb_document_chunks)
        .set({
          tags: sql`CASE WHEN ${kb_document_chunks.tags} @> ARRAY[${tag}]::text[] THEN ${kb_document_chunks.tags} ELSE array_append(${kb_document_chunks.tags}, ${tag}) END`,
          updated_at: new Date(),
        })
        .where(inArray(kb_document_chunks.id, chunkIds));
      return ok(undefined);
    } catch (cause) {
      logRepoError("DrizzleChunkCurationRepository.addTag", cause);
      return err(domainError("INFRA_FAILURE", "Failed to tag chunks.", cause));
    }
  }

  async listVersions(chunkId: string): Promise<Result<ChunkVersion[]>> {
    try {
      const rows = await this.db
        .select()
        .from(kb_chunk_versions)
        .where(eq(kb_chunk_versions.chunk_id, chunkId))
        .orderBy(desc(kb_chunk_versions.created_at));
      return ok(rows.map(toChunkVersion));
    } catch (cause) {
      logRepoError("DrizzleChunkCurationRepository.listVersions", cause);
      return err(domainError("INFRA_FAILURE", "Failed to list chunk versions.", cause));
    }
  }
}
