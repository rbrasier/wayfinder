import { EXTRACTION_JOB_NAME } from "../../../packages/adapters/src/extraction/extraction-worker";
import { getContainer } from "./container.js";
import { runTick, type TickOutcome } from "./tick.js";

// The EventBridge floor is 60s against the worker's 5s default, so an unattended
// run drains more slowly here than on a container. An operator watching the run
// screen is unaffected: that screen drives the batch engine itself through
// `extraction.tick` (phase §5.4).
export const handler = (): Promise<TickOutcome> => {
  const container = getContainer();
  return runTick(container, EXTRACTION_JOB_NAME, container.extractionWorkers);
};
