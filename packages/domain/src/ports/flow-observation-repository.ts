import type { FlowObservation, NewFlowObservation } from "../entities/flow-observation";
import type { Result } from "../result";

export interface IFlowObservationRepository {
  // Idempotent on `(session_id, node_id, kind)`, so re-running capture over an
  // already-captured session is a no-op rather than a second vote (ADR-057 §2).
  // Returns the number of rows actually written.
  createMany(observations: NewFlowObservation[]): Promise<Result<number>>;
  listUndistilledByFlow(flowId: string, limit: number): Promise<Result<FlowObservation[]>>;
  listByLesson(lessonId: string): Promise<Result<FlowObservation[]>>;
  markDistilled(observationIds: string[]): Promise<Result<void>>;
  // Flows carrying at least one undistilled observation, so the daily sweep does
  // not walk every flow in the deployment to find the few with new evidence.
  listFlowIdsWithUndistilled(limit: number): Promise<Result<string[]>>;
}
