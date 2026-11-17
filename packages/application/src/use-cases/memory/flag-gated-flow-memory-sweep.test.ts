import { describe, expect, it, vi } from "vitest";
import { domainError, err, ok, type Result } from "@wayfinder/domain";
import { FlagGatedFlowMemorySweep } from "./flag-gated-flow-memory-sweep";
import type { SweepFlowMemoryInput, SweepOutcome } from "./sweep-flow-memory";

const INPUT: SweepFlowMemoryInput = { capturedSince: null, evidenceThreshold: 3 };

const OUTCOME: SweepOutcome = { sessionsCaptured: 2, flowsDistilled: 1, lessonsProposed: 1, lessonsRetired: 0 };

const build = (flag: Result<boolean>) => {
  const sweep = { execute: vi.fn(async () => ok(OUTCOME)) };
  const isFeatureEnabled = { execute: vi.fn(async () => flag) };
  return { gated: new FlagGatedFlowMemorySweep(isFeatureEnabled, sweep), sweep, isFeatureEnabled };
};

describe("FlagGatedFlowMemorySweep", () => {
  it("runs the sweep while flow_memory is on", async () => {
    const { gated, sweep, isFeatureEnabled } = build(ok(true));

    await expect(gated.execute(INPUT)).resolves.toEqual(ok(OUTCOME));
    expect(isFeatureEnabled.execute).toHaveBeenCalledWith("flow_memory");
    expect(sweep.execute).toHaveBeenCalledWith(INPUT);
  });

  // Off means the deployment has not opted in, so the tick spends no model
  // calls and reports an empty, successful run rather than a failure.
  it("skips the sweep while flow_memory is off", async () => {
    const { gated, sweep } = build(ok(false));

    await expect(gated.execute(INPUT)).resolves.toEqual(
      ok({ sessionsCaptured: 0, flowsDistilled: 0, lessonsProposed: 0, lessonsRetired: 0 }),
    );
    expect(sweep.execute).not.toHaveBeenCalled();
  });

  it("fails the tick when the flag cannot be read, so the window is retried", async () => {
    const { gated, sweep } = build(err(domainError("INTERNAL", "flags unavailable")));

    const result = await gated.execute(INPUT);

    expect(result.error?.message).toBe("flags unavailable");
    expect(sweep.execute).not.toHaveBeenCalled();
  });
});
