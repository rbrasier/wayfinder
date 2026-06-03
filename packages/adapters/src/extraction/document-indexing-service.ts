import { err, ok } from "@rbrasier/domain";
import type {
  IDocumentChunkRepository,
  IDocumentIndexer,
  IEmbeddingsProvider,
  IndexDocumentInput,
  NewDocumentChunk,
  Result,
} from "@rbrasier/domain";
import { chunkText } from "./text-chunker";

export type { IndexDocumentInput };

// Turns an extracted document into embedded chunks ready for retrieval. Owns the
// chunk → embed → insert pipeline so the upload routes stay thin. Re-indexing the
// same storage path replaces its chunks (ADR-016 Decision 4).
export class DocumentIndexingService implements IDocumentIndexer {
  constructor(
    private readonly embeddings: IEmbeddingsProvider,
    private readonly chunks: IDocumentChunkRepository,
  ) {}

  async indexDocument(input: IndexDocumentInput): Promise<Result<{ chunkCount: number }>> {
    const deleteResult = await this.chunks.deleteByStoragePath(input.storagePath);
    if (deleteResult.error) return err(deleteResult.error);

    const pieces = chunkText(input.text, {
      stripPlaceholders: input.sourceType === "template",
    });
    if (pieces.length === 0) return ok({ chunkCount: 0 });

    const newChunks: NewDocumentChunk[] = [];
    for (let chunkIndex = 0; chunkIndex < pieces.length; chunkIndex += 1) {
      const chunkContent = pieces[chunkIndex]!;
      const embeddingResult = await this.embeddings.embed(chunkContent);
      if (embeddingResult.error) return err(embeddingResult.error);
      newChunks.push({
        flowId: input.flowId,
        sessionId: input.sessionId,
        sourceType: input.sourceType,
        storagePath: input.storagePath,
        filename: input.filename,
        chunkIndex,
        chunkText: chunkContent,
        embedding: embeddingResult.data,
      });
    }

    const insertResult = await this.chunks.insertMany(newChunks);
    if (insertResult.error) return err(insertResult.error);
    return ok({ chunkCount: newChunks.length });
  }
}
