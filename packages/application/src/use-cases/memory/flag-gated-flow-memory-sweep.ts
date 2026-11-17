import { ok, type Result } from "@wayfinder/domain";
import type { SweepFlowMemoryInput, SweepOutcome } from "./sweep-flow-memory";

interface FeatureFlagReader {
  execute(key: string): Promise<Result<boolean>>;
}

interface FlowMemorySweep {
  execute(input: SweepFlowMemoryInput): Promise<Result<SweepOutcome>>;
}

const EMPTY_OUTCOME: SweepOutcome = {
  sessionsCaptured: 0,
  flowsDistilled: 0,
  lessonsProposed: 0,
  lessonsRetired: 0,
};

// Flow memory is experimental in alpha-3: the sweep runs only while the
// flow_memory flag is on, on top of the deployment's FLOW_MEMORY_ENABLED switch.
// The flag is read every tick, so an admin's toggle takes effect without a
// restart. A skipped tick is a successful empty run, so the window advances and
// switching the flag on later does not spend model calls on a backlog.
export class FlagGatedFlowMemorySweep {
  constructor(
    private readonly isFeatureEnabled: FeatureFlagReader,
    private readonly sweep: FlowMemorySweep,
  ) {}

  async execute(input: SweepFlowMemoryInput): Promise<Result<SweepOutcome>> {
    const enabled = await this.isFeatureEnabled.execute("flow_memory");
    if (enabled.error) return enabled;
    if (!enabled.data) return ok(EMPTY_OUTCOME);
    return this.sweep.execute(input);
  }
}
