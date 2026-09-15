import type {
  ChunkListFilter,
  CuratedChunk,
  IChunkCurationRepository,
  Result,
} from "@wayfinder/domain";

export class ListCuratedChunks {
  constructor(private readonly chunks: IChunkCurationRepository) {}

  async execute(filter: ChunkListFilter): Promise<Result<CuratedChunk[]>> {
    return this.chunks.list(filter);
  }
}
