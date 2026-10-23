import { ok, type IUnattendedRunRepository, type Result } from "@rbrasier/domain";
import type { AdvanceUnattendedRunInput } from "./advance-unattended-run";

export interface ResumeStalledRunsDependencies {
  runs: Pick<IUnattendedRunRepository, "listResumableSessionIds">;
  // Starts the driver without waiting on it; the sweep must not block on a run.
  resume: (input: AdvanceUnattendedRunInput) => void;
  now: () => Date;
}

// The background sweep (ADR-065 §2): picks up unattended runs that stopped on a
// step the driver can run alone — after a callback, a crash or a missed hook —
// and drives them on. Resume-only, so it never re-prepares a person's step.
export class ResumeStalledRuns {
  constructor(private readonly dependencies: ResumeStalledRunsDependencies) {}

  async execute(input: { staleAfterMs: number; limit: number }): Promise<Result<{ resumed: number }>> {
    const staleBefore = new Date(this.dependencies.now().getTime() - input.staleAfterMs);
    const ids = await this.dependencies.runs.listResumableSessionIds(staleBefore, input.limit);
    if (ids.error) return ids;
    for (const sessionId of ids.data) this.dependencies.resume({ sessionId, resumeOnly: true });
    return ok({ resumed: ids.data.length });
  }
}
