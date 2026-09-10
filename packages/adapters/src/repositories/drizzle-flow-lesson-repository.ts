import { domainError, err, ok } from "@wayfinder/domain";
import type {
  FlowLesson,
  IFlowLessonRepository,
  LessonCandidate,
  LessonStatus,
  Result,
} from "@wayfinder/domain";
import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { ai_flow_lesson_evidence, ai_flow_lessons, ai_flow_observations } from "../db/schema/ai";
import { logRepoError } from "./log-repo-error";

const toLesson = (row: typeof ai_flow_lessons.$inferSelect): FlowLesson => ({
  id: row.id,
  flowId: row.flow_id,
  nodeId: row.node_id,
  kind: row.kind,
  statement: row.statement,
  status: row.status,
  evidenceCount: row.evidence_count,
  firstSeenAt: row.first_seen_at,
  lastSeenAt: row.last_seen_at,
  acceptedByUserId: row.accepted_by_user_id,
  acceptedAt: row.accepted_at,
  supersedesLessonId: row.supersedes_lesson_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

// The insert values for a proposed lesson. `status` is hard-coded here rather
// than taken from an argument, which is the structural half of ADR-057 §3: the
// port exposes no status parameter, and this builder offers no way to smuggle
// one in.
export const proposedLessonValues = (
  candidate: LessonCandidate,
  flowId: string,
  evidenceObservationIds: string[],
  span: { firstSeenAt: Date; lastSeenAt: Date },
) => ({
  flow_id: flowId,
  node_id: candidate.nodeId,
  kind: candidate.kind,
  statement: candidate.statement,
  status: "proposed" as const,
  evidence_count: evidenceObservationIds.length,
  first_seen_at: span.firstSeenAt,
  last_seen_at: span.lastSeenAt,
  supersedes_lesson_id: candidate.supersedesLessonId ?? null,
});

// Only an acceptance stamps a decider and a time. Those two fields are what a
// later reader joins on to reconstruct what the model was told at a given moment
// (ADR-058 §3), so writing them on a rejection would make the audit trail lie.
export const lessonStatusPatch = (
  status: LessonStatus,
  decidedByUserId: string | null,
  now: Date,
) => ({
  status,
  updated_at: now,
  ...(status === "accepted" ? { accepted_by_user_id: decidedByUserId, accepted_at: now } : {}),
});

export class DrizzleFlowLessonRepository implements IFlowLessonRepository {
  constructor(private readonly db: Database) {}

  async listByFlow(flowId: string): Promise<Result<FlowLesson[]>> {
    try {
      const rows = await this.db
        .select()
        .from(ai_flow_lessons)
        .where(eq(ai_flow_lessons.flow_id, flowId))
        .orderBy(desc(ai_flow_lessons.last_seen_at));
      return ok(rows.map(toLesson));
    } catch (cause) {
      logRepoError("DrizzleFlowLessonRepository.listByFlow", cause);
      return err(domainError("INFRA_FAILURE", "Failed to list flow lessons.", cause));
    }
  }

  async listAcceptedByFlow(flowId: string): Promise<Result<FlowLesson[]>> {
    try {
      const rows = await this.db
        .select()
        .from(ai_flow_lessons)
        .where(and(eq(ai_flow_lessons.flow_id, flowId), eq(ai_flow_lessons.status, "accepted")))
        .orderBy(desc(ai_flow_lessons.accepted_at));
      return ok(rows.map(toLesson));
    } catch (cause) {
      logRepoError("DrizzleFlowLessonRepository.listAcceptedByFlow", cause);
      return err(domainError("INFRA_FAILURE", "Failed to list accepted lessons.", cause));
    }
  }

  async findById(lessonId: string): Promise<Result<FlowLesson | null>> {
    try {
      const [row] = await this.db
        .select()
        .from(ai_flow_lessons)
        .where(eq(ai_flow_lessons.id, lessonId))
        .limit(1);
      return ok(row ? toLesson(row) : null);
    } catch (cause) {
      logRepoError("DrizzleFlowLessonRepository.findById", cause);
      return err(domainError("INFRA_FAILURE", "Failed to load lesson.", cause));
    }
  }

  // Takes no status argument and hard-codes `proposed`, so a distiller's output
  // has no path to `accepted` (ADR-057 §3). The lesson and its evidence rows are
  // written in one transaction: a lesson with no evidence is a bug, not a lesson.
  async createProposed(
    candidate: LessonCandidate,
    flowId: string,
    evidenceObservationIds: string[],
  ): Promise<Result<FlowLesson>> {
    if (evidenceObservationIds.length === 0) {
      return err(domainError("VALIDATION_FAILED", "A lesson must carry at least one observation."));
    }

    try {
      return await this.db.transaction(async (tx) => {
        const [span] = await tx
          .select({
            firstSeenAt: sql<Date>`min(${ai_flow_observations.occurred_at})`,
            lastSeenAt: sql<Date>`max(${ai_flow_observations.occurred_at})`,
          })
          .from(ai_flow_observations)
          .where(inArray(ai_flow_observations.id, evidenceObservationIds));

        const now = new Date();
        const [lesson] = await tx
          .insert(ai_flow_lessons)
          .values(
            proposedLessonValues(candidate, flowId, evidenceObservationIds, {
              firstSeenAt: span?.firstSeenAt ?? now,
              lastSeenAt: span?.lastSeenAt ?? now,
            }),
          )
          .returning();

        await tx.insert(ai_flow_lesson_evidence).values(
          evidenceObservationIds.map((observationId) => ({
            lesson_id: lesson!.id,
            observation_id: observationId,
          })),
        );

        return ok(toLesson(lesson!));
      });
    } catch (cause) {
      logRepoError("DrizzleFlowLessonRepository.createProposed", cause);
      return err(domainError("INFRA_FAILURE", "Failed to propose lesson.", cause));
    }
  }

  async setStatus(
    lessonId: string,
    status: LessonStatus,
    decidedByUserId: string | null,
  ): Promise<Result<FlowLesson>> {
    try {
      const [row] = await this.db
        .update(ai_flow_lessons)
        .set(lessonStatusPatch(status, decidedByUserId, new Date()))
        .where(eq(ai_flow_lessons.id, lessonId))
        .returning();
      if (!row) return err(domainError("NOT_FOUND", "Lesson not found."));
      return ok(toLesson(row));
    } catch (cause) {
      logRepoError("DrizzleFlowLessonRepository.setStatus", cause);
      return err(domainError("INFRA_FAILURE", "Failed to update lesson.", cause));
    }
  }

  async retireForMissingNodes(
    flowId: string,
    liveNodeIds: string[],
  ): Promise<Result<FlowLesson[]>> {
    // An empty list means the caller could not resolve the graph, not that the
    // flow has no steps — retiring on that basis would withdraw every lesson on
    // the flow at once.
    if (liveNodeIds.length === 0) return ok([]);

    try {
      const rows = await this.db
        .update(ai_flow_lessons)
        .set({ status: "retired", updated_at: new Date() })
        .where(
          and(
            eq(ai_flow_lessons.flow_id, flowId),
            notInArray(ai_flow_lessons.node_id, liveNodeIds),
            notInArray(ai_flow_lessons.status, ["retired"]),
          ),
        )
        .returning();
      return ok(rows.map(toLesson));
    } catch (cause) {
      logRepoError("DrizzleFlowLessonRepository.retireForMissingNodes", cause);
      return err(domainError("INFRA_FAILURE", "Failed to retire lessons.", cause));
    }
  }
}
