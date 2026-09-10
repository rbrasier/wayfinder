import { domainError, err, ok } from "@wayfinder/domain";
import type {
  FlowObservation,
  IFlowObservationRepository,
  NewFlowObservation,
  ObservationDetail,
  Result,
} from "@wayfinder/domain";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { Database } from "../db/client";
import { ai_flow_lesson_evidence, ai_flow_observations } from "../db/schema/ai";
import { logRepoError } from "./log-repo-error";

const toObservation = (row: typeof ai_flow_observations.$inferSelect): FlowObservation => ({
  id: row.id,
  flowId: row.flow_id,
  nodeId: row.node_id,
  sessionId: row.session_id,
  kind: row.kind,
  detail: row.detail as ObservationDetail,
  occurredAt: row.occurred_at,
  distilledAt: row.distilled_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class DrizzleFlowObservationRepository implements IFlowObservationRepository {
  constructor(private readonly db: Database) {}

  async createMany(observations: NewFlowObservation[]): Promise<Result<number>> {
    if (observations.length === 0) return ok(0);

    try {
      // `on conflict do nothing` against the (session_id, node_id, kind) unique
      // index is what makes capture idempotent: re-running it over an
      // already-captured session is a no-op rather than a second vote.
      const rows = await this.db
        .insert(ai_flow_observations)
        .values(
          observations.map((observation) => ({
            flow_id: observation.flowId,
            node_id: observation.nodeId,
            session_id: observation.sessionId,
            kind: observation.kind,
            detail: observation.detail,
            occurred_at: observation.occurredAt,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: ai_flow_observations.id });
      return ok(rows.length);
    } catch (cause) {
      logRepoError("DrizzleFlowObservationRepository.createMany", cause);
      return err(domainError("INFRA_FAILURE", "Failed to record flow observations.", cause));
    }
  }

  async listUndistilledByFlow(flowId: string, limit: number): Promise<Result<FlowObservation[]>> {
    try {
      const rows = await this.db
        .select()
        .from(ai_flow_observations)
        .where(
          and(
            eq(ai_flow_observations.flow_id, flowId),
            isNull(ai_flow_observations.distilled_at),
          ),
        )
        .orderBy(asc(ai_flow_observations.occurred_at))
        .limit(limit);
      return ok(rows.map(toObservation));
    } catch (cause) {
      logRepoError("DrizzleFlowObservationRepository.listUndistilledByFlow", cause);
      return err(domainError("INFRA_FAILURE", "Failed to list flow observations.", cause));
    }
  }

  async listByLesson(lessonId: string): Promise<Result<FlowObservation[]>> {
    try {
      const rows = await this.db
        .select({ observation: ai_flow_observations })
        .from(ai_flow_lesson_evidence)
        .innerJoin(
          ai_flow_observations,
          eq(ai_flow_lesson_evidence.observation_id, ai_flow_observations.id),
        )
        .where(eq(ai_flow_lesson_evidence.lesson_id, lessonId))
        .orderBy(asc(ai_flow_observations.occurred_at));
      return ok(rows.map((row) => toObservation(row.observation)));
    } catch (cause) {
      logRepoError("DrizzleFlowObservationRepository.listByLesson", cause);
      return err(domainError("INFRA_FAILURE", "Failed to list lesson evidence.", cause));
    }
  }

  async markDistilled(observationIds: string[]): Promise<Result<void>> {
    if (observationIds.length === 0) return ok(undefined);

    try {
      await this.db
        .update(ai_flow_observations)
        .set({ distilled_at: new Date(), updated_at: new Date() })
        .where(inArray(ai_flow_observations.id, observationIds));
      return ok(undefined);
    } catch (cause) {
      logRepoError("DrizzleFlowObservationRepository.markDistilled", cause);
      return err(domainError("INFRA_FAILURE", "Failed to mark observations distilled.", cause));
    }
  }

  async listFlowIdsWithUndistilled(limit: number): Promise<Result<string[]>> {
    try {
      const rows = await this.db
        .selectDistinct({ flowId: ai_flow_observations.flow_id })
        .from(ai_flow_observations)
        .where(isNull(ai_flow_observations.distilled_at))
        .limit(limit);
      return ok(rows.map((row) => row.flowId));
    } catch (cause) {
      logRepoError("DrizzleFlowObservationRepository.listFlowIdsWithUndistilled", cause);
      return err(domainError("INFRA_FAILURE", "Failed to list flows awaiting distillation.", cause));
    }
  }
}
