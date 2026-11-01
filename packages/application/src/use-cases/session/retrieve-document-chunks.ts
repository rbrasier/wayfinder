import { err, ok } from "@wayfinder/domain";
import type {
  IDocumentChunkRepository,
  IEmbeddingsProvider,
  Result,
  RetrievedChunk,
} from "@wayfinder/domain";

// Flow context docs are a curated knowledge base, but a conversational turn is
// not a well-formed question about it: half a sentence of operator input embeds
// to something that clears no strict threshold, so the guidance never reached
// the prompt and the step ran on the model's own priors. The floor is therefore
// permissive and the limit generous, with `buildTurnRetrievalQueries` supplying
// a second, step-shaped query to aim it (ADR-016 Decision 5, revised).
// Session uploads are documents the operator deliberately attached for the
// current request, so they stay permissive for their own reason — a short
// attachment must reach the prompt even when the message is loosely worded.
const DEFAULT_FLOW_LIMIT = 8;
const DEFAULT_FLOW_MIN_SIMILARITY = 0.25;
const DEFAULT_SESSION_LIMIT = 8;
const DEFAULT_SESSION_MIN_SIMILARITY = 0.2;

export interface RetrieveDocumentChunksInput {
  flowId: string | null;
  sessionId: string | null;
  // One retrieval key. Kept for the single-query callers (extraction, search)
  // that have exactly one thing to ask about.
  query?: string;
  // Several retrieval keys, embedded and searched independently, then merged.
  // A conversational turn passes two: what is being said, and what the step is
  // about. Blank and duplicate entries are dropped before any embedding call.
  queries?: readonly string[];
  flowLimit?: number;
  flowMinSimilarity?: number;
  sessionLimit?: number;
  sessionMinSimilarity?: number;
}

// A chunk's identity for de-duplication. `RetrievedChunk` carries no id, and
// these three fields are what uniquely place a chunk in its source document.
const chunkKey = (chunk: RetrievedChunk): string =>
  `${chunk.sourceType} ${chunk.filename} ${chunk.chunkIndex}`;

// Per-turn retrieval (phase doc §8): embed each query, then fetch the most
// similar chunks. The flow scope (context docs/templates) and the session scope
// (operator uploads) are searched separately so each can use its own similarity
// threshold and limit, then merged and ranked by similarity. Returns nothing
// for a blank query or when no scope is given so we never spend an embedding
// call on an empty turn.
export class RetrieveDocumentChunks {
  constructor(
    private readonly embeddings: IEmbeddingsProvider,
    private readonly chunks: IDocumentChunkRepository,
  ) {}

  async execute(input: RetrieveDocumentChunksInput): Promise<Result<RetrievedChunk[]>> {
    const queries = this.resolveQueries(input);
    if (queries.length === 0) return ok([]);
    if (!input.flowId && !input.sessionId) return ok([]);

    // Keyed by chunk identity, keeping the best score: a chunk both queries
    // matched is one excerpt, and the prompt should see it once, ranked by the
    // query that found it most convincingly.
    const best = new Map<string, RetrievedChunk>();
    for (const query of queries) {
      const retrieved = await this.retrieveOne(input, query);
      if (retrieved.error) return retrieved;
      for (const chunk of retrieved.data) {
        const key = chunkKey(chunk);
        const existing = best.get(key);
        if (!existing || chunk.similarity > existing.similarity) best.set(key, chunk);
      }
    }

    // Lead the prompt with the strongest matches regardless of their scope.
    return ok([...best.values()].sort((first, second) => second.similarity - first.similarity));
  }

  private resolveQueries(input: RetrieveDocumentChunksInput): string[] {
    const candidates = input.queries ?? (input.query === undefined ? [] : [input.query]);
    return [...new Set(candidates.map((query) => query.trim()).filter((query) => query.length > 0))];
  }

  private async retrieveOne(
    input: RetrieveDocumentChunksInput,
    query: string,
  ): Promise<Result<RetrievedChunk[]>> {
    const embeddingResult = await this.embeddings.embed(query);
    if (embeddingResult.error) return err(embeddingResult.error);
    const embedding = embeddingResult.data;

    const retrieved: RetrievedChunk[] = [];

    if (input.flowId) {
      const flowResult = await this.chunks.search({
        flowId: input.flowId,
        sessionId: null,
        embedding,
        limit: input.flowLimit ?? DEFAULT_FLOW_LIMIT,
        minSimilarity: input.flowMinSimilarity ?? DEFAULT_FLOW_MIN_SIMILARITY,
      });
      if (flowResult.error) return err(flowResult.error);
      retrieved.push(...flowResult.data);
    }

    if (input.sessionId) {
      const sessionResult = await this.chunks.search({
        flowId: null,
        sessionId: input.sessionId,
        embedding,
        limit: input.sessionLimit ?? DEFAULT_SESSION_LIMIT,
        minSimilarity: input.sessionMinSimilarity ?? DEFAULT_SESSION_MIN_SIMILARITY,
      });
      if (sessionResult.error) return err(sessionResult.error);
      retrieved.push(...sessionResult.data);
    }

    return ok(retrieved);
  }
}
