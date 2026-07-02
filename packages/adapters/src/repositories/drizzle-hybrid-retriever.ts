import { domainError, err, ok } from "@rbrasier/domain";
import type {
  ChunkSearchResult,
  CuratedChunk,
  FusionWeights,
  HybridRetrievalQuery,
  IHybridRetriever,
  Result,
} from "@rbrasier/domain";
import { sql, type SQL } from "drizzle-orm";
import type { Database } from "../db/client";
import { logRepoError } from "./log-repo-error";

// Defaults from ADR-029 Decision 3: semantic-leaning. A deployment can override
// these (e.g. via runtime settings) by constructing the retriever with weights.
const DEFAULT_WEIGHTS: FusionWeights = { vector: 0.7, keyword: 0.3 };

// Raw rows from the search SQL. postgres-js returns float8 as number, text[] as
// string[], and timestamptz as Date.
interface SearchRow {
  id: string;
  flow_id: string | null;
  session_id: string | null;
  source_type: CuratedChunk["sourceType"];
  storage_path: string;
  filename: string;
  chunk_index: number;
  chunk_text: string;
  status: CuratedChunk["status"];
  tags: string[];
  retrieval_count: number;
  last_retrieved_at: Date | null;
  created_at: Date;
  updated_at: Date;
  score: number;
}

const SELECTED_COLUMNS = sql`id, flow_id, session_id, source_type, storage_path, filename, chunk_index, chunk_text, status, tags, retrieval_count, last_retrieved_at, created_at, updated_at`;

// Strip author-typed wrapping quotes, then escape LIKE metacharacters so the
// term matches literally. Without this, `%` and `_` in a SKU/code (e.g. `100%`,
// `ITEM_42`) act as wildcards and the "exact" guardrail silently over-matches.
// Postgres's default LIKE escape is backslash, so no ESCAPE clause is needed.
export const buildExactLikePattern = (rawText: string): string => {
  const term = rawText.replace(/^"|"$/g, "");
  const escaped = term.replace(/[\\%_]/g, "\\$&");
  return `%${escaped}%`;
};

const scopeCondition = (scope: HybridRetrievalQuery["scope"]): SQL =>
  "flowId" in scope
    ? sql`flow_id = ${scope.flowId}`
    : sql`session_id = ${scope.sessionId}`;

// Strip wrapping quotes a power user may have typed ("INV-2024-001") and split
// into word tokens for highlighting.
const wordTokens = (text: string): string[] => {
  const matches = text.replace(/^"|"$/g, "").toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu);
  return matches ? [...new Set(matches)] : [];
};

const matchedTermsFor = (text: string, chunkText: string): string[] => {
  const haystack = chunkText.toLowerCase();
  return wordTokens(text).filter((token) => haystack.includes(token));
};

const toResult = (row: SearchRow, queryText: string): ChunkSearchResult => ({
  chunk: {
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
  },
  score: Number(row.score),
  matchedTerms: matchedTermsFor(queryText, row.chunk_text),
});

export class DrizzleHybridRetriever implements IHybridRetriever {
  constructor(
    private readonly db: Database,
    private readonly weights: FusionWeights = DEFAULT_WEIGHTS,
  ) {}

  async retrieve(query: HybridRetrievalQuery): Promise<Result<ChunkSearchResult[]>> {
    try {
      const statement = query.mode === "exact" ? this.exactQuery(query) : this.semanticQuery(query);
      const rows = (await this.db.execute(statement)) as unknown as SearchRow[];
      return ok([...rows].map((row) => toResult(row, query.text)));
    } catch (cause) {
      logRepoError("DrizzleHybridRetriever.retrieve", cause);
      return err(domainError("INFRA_FAILURE", "Failed to search knowledge.", cause));
    }
  }

  // Literal substring match (ADR-029 Decision 2): the guardrail for SKUs, codes,
  // and legal references where a near-miss is a wrong answer. ILIKE guarantees the
  // exact term is present; vector similarity is irrelevant here.
  private exactQuery(query: HybridRetrievalQuery): SQL {
    const pattern = buildExactLikePattern(query.text);
    return sql`
      SELECT ${SELECTED_COLUMNS}, 1 AS score
      FROM kb_document_chunks
      WHERE ${scopeCondition(query.scope)} AND chunk_text ILIKE ${pattern}
      ORDER BY updated_at DESC
      LIMIT ${query.limit}
    `;
  }

  // Min-max normalise the vector similarity and the ts_rank within the candidate
  // set, then combine with the configured weights (ADR-029 Decision 3).
  private semanticQuery(query: HybridRetrievalQuery): SQL {
    const embeddingLiteral = `[${(query.embedding ?? []).join(",")}]`;
    return sql`
      WITH scored AS (
        SELECT ${SELECTED_COLUMNS},
          (1 - (embedding <=> ${embeddingLiteral}::vector)) AS vec_sim,
          ts_rank(content_tsv, plainto_tsquery('english', ${query.text})) AS kw_rank
        FROM kb_document_chunks
        WHERE ${scopeCondition(query.scope)}
      ),
      bounds AS (
        SELECT min(vec_sim) AS min_v, max(vec_sim) AS max_v, max(kw_rank) AS max_k FROM scored
      )
      SELECT ${SELECTED_COLUMNS},
        (${this.weights.vector} * (CASE WHEN bounds.max_v = bounds.min_v THEN 1
              ELSE (scored.vec_sim - bounds.min_v) / (bounds.max_v - bounds.min_v) END)
         + ${this.weights.keyword} * (CASE WHEN bounds.max_k = 0 THEN 0
              ELSE scored.kw_rank / bounds.max_k END)) AS score
      FROM scored CROSS JOIN bounds
      ORDER BY score DESC
      LIMIT ${query.limit}
    `;
  }
}
