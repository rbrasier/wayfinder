import { RETENTION_JOB_NAME } from "../../../packages/adapters/src/retention/retention-worker";
import { getContainer } from "./container.js";
import { runTick, type TickOutcome } from "./tick.js";

// Retention is a slow sweep — the container default is daily — so a scheduled
// invocation matches its shape exactly.
export const handler = (): Promise<TickOutcome> => {
  const container = getContainer();
  return runTick(container, RETENTION_JOB_NAME, container.retentionWorkers);
};
