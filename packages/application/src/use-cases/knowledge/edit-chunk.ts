import { domainError, err } from "@rbrasier/domain";
import type {
  CuratedChunk,
  IChunkCurationRepository,
  IEmbeddingsProvider,
  Result,
} from "@rbrasier/domain";

export interface EditChunkInput {
  chunkId: string;
  newText: string;
  editedBy: string | null;
  reason: string | null;
}

// Editing chunk text re-embeds it so it stays in the correct semantic cluster
// (ADR-028 Decision 4), and the repository snapshots the prior version for
// revert. An empty edit is rejected — a chunk must always carry text.
export class EditChunk {
  constructor(
    private readonly chunks: IChunkCurationRepository,
    private readonly embeddings: IEmbeddingsProvider,
  ) {}

  async execute(input: EditChunkInput): Promise<Result<CuratedChunk>> {
    const newText = input.newText.trim();
    if (newText.length === 0) {
      return err(domainError("VALIDATION_FAILED", "Chunk text cannot be empty."));
    }

    const embeddingResult = await this.embeddings.embed(newText);
    if (embeddingResult.error) return err(embeddingResult.error);

    return this.chunks.applyEdit({
      chunkId: input.chunkId,
      newText,
      newEmbedding: embeddingResult.data,
      editedBy: input.editedBy,
      reason: input.reason,
    });
  }
}
