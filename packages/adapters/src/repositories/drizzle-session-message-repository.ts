import { asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import {
  domainError,
  err,
  ok,
  type AiTurnPayload,
  type DocumentStatus,
  type GatheredContextItem,
  type ISessionMessageRepository,
  type NewSessionMessage,
  type Result,
  type SessionDocument,
  type SessionListSummary,
  type SessionMessage,
} from "@rbrasier/domain";
import type { Database } from "../db/client";
import { app_session_messages } from "../db/schema/wayfinder";

// Newest `limit` rows for a session. Ordered DESC so the LIMIT keeps the tail;
// the repository reverses the result back to chronological order. Bounding this
// read is the core of scaling wall #1 — the whole history is never scanned.
export const buildLatestBySessionStatement = (sessionId: string, limit: number): SQL => sql`
  SELECT * FROM ${app_session_messages}
  WHERE ${app_session_messages.session_id} = ${sessionId}
  ORDER BY ${app_session_messages.created_at} DESC
  LIMIT ${limit}
`;

// Rows created strictly after the cursor, chronological — the incremental delta
// a poller/replay needs instead of the full transcript.
export const buildListSinceStatement = (sessionId: string, afterCreatedAt: Date): SQL => sql`
  SELECT * FROM ${app_session_messages}
  WHERE ${app_session_messages.session_id} = ${sessionId}
    AND ${app_session_messages.created_at} > ${afterCreatedAt}
  ORDER BY ${app_session_messages.created_at} ASC
`;

// Rows with seq strictly greater than the cursor, ordered by seq — the exact
// delta an SSE client replays on reconnect from its Last-Event-ID.
export const buildListSinceSeqStatement = (sessionId: string, afterSeq: number): SQL => sql`
  SELECT * FROM ${app_session_messages}
  WHERE ${app_session_messages.session_id} = ${sessionId}
    AND ${app_session_messages.seq} > ${afterSeq}
  ORDER BY ${app_session_messages.seq} ASC
`;

// Newest assistant message per session for the whole batch in one round-trip.
// DISTINCT ON keeps the first row per session under the seq-DESC ordering — the
// latest assistant message — so the list view never scans a session's history.
export const buildSessionListLastAssistantStatement = (sessionIds: readonly string[]): SQL => sql`
  SELECT DISTINCT ON (${app_session_messages.session_id})
    ${app_session_messages.session_id} AS session_id,
    ${app_session_messages.content} AS content
  FROM ${app_session_messages}
  WHERE ${inArray(app_session_messages.session_id, [...sessionIds])}
    AND ${app_session_messages.role} = 'assistant'
  ORDER BY ${app_session_messages.session_id}, ${app_session_messages.seq} DESC
`;

// Flattens the aiPayload.contextGathered arrays from every step-anchored
// assistant message in one session into a single chronological array. Reads
// only the aiPayload column and uses the (session_id, seq) composite index, so
// the query cost scales with rows-per-session, not row width — the bounded
// turn read pairs with this so gatheredContext still reflects the full history
// without loading the whole transcript row-wide.
export const buildAggregateGatheredContextStatement = (sessionId: string): SQL => sql`
  SELECT ${app_session_messages.ai_payload}->'contextGathered' AS items
  FROM ${app_session_messages}
  WHERE ${app_session_messages.session_id} = ${sessionId}
    AND ${app_session_messages.role} = 'assistant'
    AND ${app_session_messages.step_node_id} IS NOT NULL
    AND ${app_session_messages.ai_payload} IS NOT NULL
    AND jsonb_typeof(${app_session_messages.ai_payload}->'contextGathered') = 'array'
  ORDER BY ${app_session_messages.seq} ASC
`;

// Highest confidence per (session, step) across the batch, aggregated SQL-side
// so the per-step best the list view shows is one grouped query, not a
// per-session in-memory reduction over full histories.
export const buildSessionListBestConfidenceStatement = (sessionIds: readonly string[]): SQL => sql`
  SELECT
    ${app_session_messages.session_id} AS session_id,
    ${app_session_messages.step_node_id} AS step_node_id,
    MAX(${app_session_messages.confidence}) AS best_confidence
  FROM ${app_session_messages}
  WHERE ${inArray(app_session_messages.session_id, [...sessionIds])}
    AND ${app_session_messages.role} = 'assistant'
    AND ${app_session_messages.step_node_id} IS NOT NULL
    AND ${app_session_messages.confidence} IS NOT NULL
  GROUP BY ${app_session_messages.session_id}, ${app_session_messages.step_node_id}
`;

const toEntity = (row: typeof app_session_messages.$inferSelect): SessionMessage => ({
  id: row.id,
  sessionId: row.session_id,
  role: row.role,
  content: row.content,
  senderUserId: row.sender_user_id ?? null,
  confidence: row.confidence,
  stepNodeId: row.step_node_id,
  document: row.document ?? null,
  documentStatus: row.document_status ?? null,
  aiPayload: (row.ai_payload as AiTurnPayload | null) ?? null,
  seq: typeof row.seq === "number" ? row.seq : Number(row.seq),
  createdAt: row.created_at,
});

export class DrizzleSessionMessageRepository implements ISessionMessageRepository {
  constructor(private readonly db: Database) {}

  async create(input: NewSessionMessage): Promise<Result<SessionMessage>> {
    try {
      const [row] = await this.db
        .insert(app_session_messages)
        .values({
          session_id: input.sessionId,
          role: input.role,
          content: input.content,
          sender_user_id: input.senderUserId ?? null,
          confidence: input.confidence ?? null,
          step_node_id: input.stepNodeId ?? null,
          document: input.document ?? undefined,
          document_status: input.documentStatus ?? undefined,
          ai_payload: input.aiPayload ?? undefined,
        })
        .returning();
      if (!row) return err(domainError("INFRA_FAILURE", "Message insert returned no row."));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to create session message.", cause));
    }
  }

  async findById(id: string): Promise<Result<SessionMessage | null>> {
    try {
      const [row] = await this.db
        .select()
        .from(app_session_messages)
        .where(eq(app_session_messages.id, id));
      return ok(row ? toEntity(row) : null);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to find session message.", cause));
    }
  }

  async listBySession(sessionId: string): Promise<Result<SessionMessage[]>> {
    try {
      const rows = await this.db
        .select()
        .from(app_session_messages)
        .where(eq(app_session_messages.session_id, sessionId))
        .orderBy(asc(app_session_messages.created_at));
      return ok(rows.map(toEntity));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list session messages.", cause));
    }
  }

  async aggregateGatheredContext(sessionId: string): Promise<Result<GatheredContextItem[]>> {
    try {
      const rows = (await this.db.execute(
        buildAggregateGatheredContextStatement(sessionId),
      )) as unknown as { items: unknown }[];
      const items: GatheredContextItem[] = [];
      for (const row of rows) {
        if (!Array.isArray(row.items)) continue;
        for (const raw of row.items) {
          if (
            raw &&
            typeof raw === "object" &&
            typeof (raw as { key?: unknown }).key === "string" &&
            typeof (raw as { value?: unknown }).value === "string"
          ) {
            items.push({
              key: (raw as { key: string }).key,
              value: (raw as { value: string }).value,
            });
          }
        }
      }
      return ok(items);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to aggregate gathered context.", cause));
    }
  }

  async latestBySession(sessionId: string, limit: number): Promise<Result<SessionMessage[]>> {
    if (!Number.isInteger(limit) || limit <= 0) {
      return err(domainError("VALIDATION_FAILED", "latestBySession limit must be a positive integer."));
    }
    try {
      const rows = (await this.db.execute(
        buildLatestBySessionStatement(sessionId, limit),
      )) as unknown as (typeof app_session_messages.$inferSelect)[];
      // Query returns newest-first so the LIMIT keeps the tail; hand back the
      // caller a chronological slice.
      return ok(rows.map(toEntity).reverse());
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to load latest session messages.", cause));
    }
  }

  async listSince(sessionId: string, afterCreatedAt: Date): Promise<Result<SessionMessage[]>> {
    try {
      const rows = (await this.db.execute(
        buildListSinceStatement(sessionId, afterCreatedAt),
      )) as unknown as (typeof app_session_messages.$inferSelect)[];
      return ok(rows.map(toEntity));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to load session messages since cursor.", cause));
    }
  }

  async listSinceSeq(sessionId: string, afterSeq: number): Promise<Result<SessionMessage[]>> {
    if (!Number.isInteger(afterSeq) || afterSeq < 0) {
      return err(domainError("VALIDATION_FAILED", "listSinceSeq afterSeq must be a non-negative integer."));
    }
    try {
      const rows = (await this.db.execute(
        buildListSinceSeqStatement(sessionId, afterSeq),
      )) as unknown as (typeof app_session_messages.$inferSelect)[];
      return ok(rows.map(toEntity));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to load session messages since seq.", cause));
    }
  }

  async summariseForSessionList(
    sessionIds: readonly string[],
  ): Promise<Result<SessionListSummary[]>> {
    if (sessionIds.length === 0) return ok([]);
    try {
      const [lastRows, confidenceRows] = await Promise.all([
        this.db.execute(buildSessionListLastAssistantStatement(sessionIds)) as unknown as Promise<
          { session_id: string; content: string | null }[]
        >,
        this.db.execute(buildSessionListBestConfidenceStatement(sessionIds)) as unknown as Promise<
          { session_id: string; step_node_id: string; best_confidence: number }[]
        >,
      ]);

      const summaries = new Map<string, SessionListSummary>();
      const summaryFor = (sessionId: string): SessionListSummary => {
        const existing = summaries.get(sessionId);
        if (existing) return existing;
        const created: SessionListSummary = {
          sessionId,
          lastAssistantContent: null,
          bestConfidenceByStep: {},
        };
        summaries.set(sessionId, created);
        return created;
      };

      for (const row of lastRows) {
        summaryFor(row.session_id).lastAssistantContent = row.content ?? null;
      }
      for (const row of confidenceRows) {
        summaryFor(row.session_id).bestConfidenceByStep[row.step_node_id] = Number(row.best_confidence);
      }

      return ok([...summaries.values()]);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to summarise sessions for list.", cause));
    }
  }

  async updateDocument(id: string, document: SessionDocument): Promise<Result<SessionMessage>> {
    try {
      const [row] = await this.db
        .update(app_session_messages)
        .set({ document, document_status: "complete" })
        .where(eq(app_session_messages.id, id))
        .returning();
      if (!row) return err(domainError("NOT_FOUND", "Session message not found."));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to update session message document.", cause));
    }
  }

  async updateDocumentStatus(id: string, status: DocumentStatus): Promise<Result<SessionMessage>> {
    try {
      const [row] = await this.db
        .update(app_session_messages)
        .set({ document_status: status })
        .where(eq(app_session_messages.id, id))
        .returning();
      if (!row) return err(domainError("NOT_FOUND", "Session message not found."));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to update session message document status.", cause));
    }
  }

  async updateAiPayload(id: string, aiPayload: AiTurnPayload): Promise<Result<SessionMessage>> {
    try {
      const [row] = await this.db
        .update(app_session_messages)
        .set({ ai_payload: aiPayload })
        .where(eq(app_session_messages.id, id))
        .returning();
      if (!row) return err(domainError("NOT_FOUND", "Session message not found."));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to update session message AI payload.", cause));
    }
  }
}
