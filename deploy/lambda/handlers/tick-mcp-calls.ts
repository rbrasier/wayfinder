import { MCP_CALL_JOB_NAME } from "../../../packages/adapters/src/mcp/mcp-call-worker";
import { getContainer } from "./container.js";
import { runTick, type TickOutcome } from "./tick.js";

// Queued MCP node calls (ADR-062 §3). A Lambda is frozen once its handler
// returns, so this tick drains — it waits for every call it started — rather
// than leaving calls in flight. The EventBridge floor means a queued call can
// wait up to a minute to start here, against two seconds on a container.
export const handler = (): Promise<TickOutcome> => {
  const container = getContainer();
  const drainingWorkers = container.mcpCallWorkers.map((worker) => ({ tick: () => worker.drain() }));
  return runTick(container, MCP_CALL_JOB_NAME, drainingWorkers);
};
