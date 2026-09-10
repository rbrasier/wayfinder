import {
  err,
  ok,
  type IFlowObservationRepository,
  type ISessionRepository,
  type Result,
} from "@wayfinder/domain";
import type { CaptureSessionObservations } from "./capture-session-observations";
import type { DistilFlowLessons } from "./distil-flow-lessons";

export interface SweepFlowMemoryInput {
  // Terminal sessions that ended after this instant are candidates for capture.
  // The worker passes its own last successful run, so the sweep catches up after
  // a gap instead of rescanning every session in the deployment. `createMany` is
  // idempotent, so an overlapping window is harmless.
  capturedSince: Date | null;
  evidenceThreshold: number;
  maxSessionsPerRun?: number;
  maxFlowsPerRun?: number;
}

export interface SweepOutcome {
  sessionsCaptured: number;
  flowsDistilled: number;
  lessonsProposed: number;
  lessonsRetired: number;
}

const DEFAULT_MAX_SESSIONS = 200;
const DEFAULT_MAX_FLOWS = 25;

// One tick of flow memory: capture from sessions that have finished since the
// last run, then distil the flows that now carry enough evidence. Capture runs
// first so a session that ended minutes ago can contribute to tonight's lessons
// rather than tomorrow's.
export class SweepFlowMemory {
  constructor(
    private readonly sessions: ISessionRepository,
    private readonly observations: IFlowObservationRepository,
    private readonly capture: CaptureSessionObservations,
    private readonly distil: DistilFlowLessons,
  ) {}

  async execute(input: SweepFlowMemoryInput): Promise<Result<SweepOutcome>> {
    const outcome: SweepOutcome = {
      sessionsCaptured: 0,
      flowsDistilled: 0,
      lessonsProposed: 0,
      lessonsRetired: 0,
    };

    const terminalResult = await this.sessions.listTerminalSince(
      input.capturedSince,
      input.maxSessionsPerRun ?? DEFAULT_MAX_SESSIONS,
    );
    if (terminalResult.error) return err(terminalResult.error);

    for (const session of terminalResult.data) {
      const captured = await this.capture.execute(session.id);
      // One unreadable session must not stop the sweep: the next tick will try it
      // again, and the others still need capturing tonight.
      if (captured.error) continue;
      outcome.sessionsCaptured += 1;
    }

    const flowsResult = await this.observations.listFlowIdsWithUndistilled(
      input.maxFlowsPerRun ?? DEFAULT_MAX_FLOWS,
    );
    if (flowsResult.error) return err(flowsResult.error);

    for (const flowId of flowsResult.data) {
      const distilled = await this.distil.execute({
        flowId,
        evidenceThreshold: input.evidenceThreshold,
      });
      if (distilled.error) continue;
      outcome.flowsDistilled += 1;
      outcome.lessonsProposed += distilled.data.proposed;
      outcome.lessonsRetired += distilled.data.retired;
    }

    return ok(outcome);
  }
}
