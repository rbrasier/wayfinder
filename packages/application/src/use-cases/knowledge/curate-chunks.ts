import { domainError, err } from "@rbrasier/domain";
import type {
  ChunkStatus,
  ChunkVersion,
  CuratedChunk,
  IChunkCurationRepository,
  Result,
} from "@rbrasier/domain";

// Bulk lifecycle and tagging actions over a multi-selection, plus revert and
// version history (ADR-028). Kept together because they are thin pass-throughs
// over the same repository; each guards an empty selection so a no-op never
// reaches the database.

export class SetChunkStatus {
  constructor(private readonly chunks: IChunkCurationRepository) {}

  async execute(input: { chunkIds: string[]; status: ChunkStatus }): Promise<Result<void>> {
    if (input.chunkIds.length === 0) {
      return err(domainError("VALIDATION_FAILED", "Select at least one item."));
    }
    return this.chunks.setStatus(input.chunkIds, input.status);
  }
}

export class TagChunks {
  constructor(private readonly chunks: IChunkCurationRepository) {}

  async execute(input: { chunkIds: string[]; tag: string }): Promise<Result<void>> {
    const tag = input.tag.trim();
    if (input.chunkIds.length === 0) {
      return err(domainError("VALIDATION_FAILED", "Select at least one item."));
    }
    if (tag.length === 0) {
      return err(domainError("VALIDATION_FAILED", "Tag cannot be empty."));
    }
    return this.chunks.addTag(input.chunkIds, tag);
  }
}

export class RevertChunk {
  constructor(private readonly chunks: IChunkCurationRepository) {}

  async execute(input: {
    chunkId: string;
    versionId: string;
    editedBy: string | null;
  }): Promise<Result<CuratedChunk>> {
    return this.chunks.revert(input);
  }
}

export class ListChunkVersions {
  constructor(private readonly chunks: IChunkCurationRepository) {}

  async execute(chunkId: string): Promise<Result<ChunkVersion[]>> {
    return this.chunks.listVersions(chunkId);
  }
}
