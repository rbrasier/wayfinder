import {
  EMPTY_MCP_TOOL_SETTINGS,
  err,
  isFlowUsableClassification,
  MAX_MCP_CALL_TOTAL_MS,
  mcpToolDisplayTitle,
  ok,
  startToolProgress,
  type IFlowNodeRepository,
  type IMcpCallQueue,
  type IMcpClient,
  type IMcpServerRepository,
  type IMcpToolRepository,
  type IntervalScheduler,
  type ISessionEventBus,
  type ISessionMessageRepository,
  type McpCallJob,
  type McpServer,
  type McpSourceStatus,
  type McpToolSettings,
  type Result,
  type SessionEvent,
} from "@wayfinder/domain";
import type { ApplyAutoNodeResult } from "../session/apply-auto-node-result";

// A running row older than the longest allowed call (every page) plus a grace
// period belongs to a worker that died mid-call; nothing else will finish it.
const STALE_AFTER_MS = MAX_MCP_CALL_TOTAL_MS + 60_000;

export interface ExecuteQueuedMcpCallsDeps {
  queue: IMcpCallQueue;
  servers: IMcpServerRepository;
  tools: IMcpToolRepository;
  client: IMcpClient;
  applyResult: Pick<ApplyAutoNodeResult, "execute">;
  flowNodes: IFlowNodeRepository;
  sessionMessages: ISessionMessageRepository;
  sessionEvents: ISessionEventBus;
  clock?: { now(): Date };
  scheduler?: IntervalScheduler;
}

const intervalScheduler: IntervalScheduler = {
  every: (intervalMs, run) => {
    const timer = setInterval(run, intervalMs);
    return () => clearInterval(timer);
  },
};

export interface ExecuteQueuedMcpCallsOutput {
  started: number;
  failedStale: number;
  // Settles when every call started by this tick has finished. The tick itself
  // returns as soon as the calls are under way, so one slow source never stops
  // the worker claiming the next call.
  completion: Promise<void>;
}

interface ToolDescriptor {
  title: string;
  settings: McpToolSettings;
}

const STATUS_NOTES: Partial<Record<McpSourceStatus["kind"], string>> = {
  "no-data": " The source reported no data.",
  "upstream-gap": " The source reported a gap in its data.",
};

// Drains the `job_mcp_calls` queue (ADR-062 §3): one tick fails calls a dead
// worker abandoned, then claims up to `limit` calls and starts them all at once —
// each can take tens of seconds, so running them one after another would make
// the last wait for all the others.
export class ExecuteQueuedMcpCalls {
  private readonly clock: { now(): Date };

  constructor(private readonly deps: ExecuteQueuedMcpCallsDeps) {
    this.clock = deps.clock ?? { now: () => new Date() };
  }

  async execute(input: { limit: number }): Promise<Result<ExecuteQueuedMcpCallsOutput>> {
    const staleBefore = new Date(this.clock.now().getTime() - STALE_AFTER_MS);
    const stale = await this.deps.queue.listStaleRunning(staleBefore);
    if (stale.error) return err(stale.error);
    for (const job of stale.data) {
      await this.fail(job, await this.nodeName(job), "the call did not finish");
    }

    if (input.limit <= 0) return ok({ started: 0, failedStale: stale.data.length, completion: Promise.resolve() });
    const claimed = await this.deps.queue.claimPending(input.limit);
    if (claimed.error) return err(claimed.error);
    const completion = Promise.all(claimed.data.map((job) => this.run(job))).then(() => undefined);

    return ok({ started: claimed.data.length, failedStale: stale.data.length, completion });
  }

  private async run(job: McpCallJob): Promise<void> {
    const nodeName = await this.nodeName(job);
    const server = await this.usableServer(job);
    if (typeof server === "string") {
      await this.fail(job, nodeName, server);
      return;
    }

    const tool = await this.toolDescriptor(job);
    const progress = startToolProgress({
      callId: job.id,
      toolTitle: tool.title,
      serverLabel: server.label,
      now: () => this.clock.now().getTime(),
      scheduler: this.deps.scheduler ?? intervalScheduler,
      emit: (event) => void this.publish(job.sessionId, event),
    });
    const called = await this.deps.client.callTool(server, job.toolName, job.arguments, {
      settings: tool.settings,
      context: {
        actorId: job.actorId,
        sessionId: job.sessionId,
        flowId: job.flowId,
        nodeId: job.nodeId,
        path: "node",
      },
      onPage: progress.page,
    });
    progress.stop();

    if (called.error) {
      await this.fail(job, nodeName, called.error.message);
      return;
    }
    if (called.data.sourceStatus?.kind === "source-unavailable") {
      await this.fail(job, nodeName, "the source is unavailable");
      return;
    }

    await this.deps.applyResult.execute({
      sessionId: job.sessionId,
      correlationId: job.correlationId,
      nodeId: job.nodeId,
      status: "completed",
      data: { output: called.data.output },
      verbatim: server.verbatimOnly,
      citations: called.data.citations,
    });
    await this.deps.queue.markSucceeded(job.id);
    const note = called.data.sourceStatus ? (STATUS_NOTES[called.data.sourceStatus.kind] ?? "") : "";
    await this.postMessage(job, `Completed tool step: ${nodeName}.${note}`);
  }

  // The server is re-checked here, not trusted from enqueue time: an admin can
  // disable or reclassify it while the call waits, and that decision must hold.
  private async usableServer(job: McpCallJob): Promise<McpServer | string> {
    const found = await this.deps.servers.findById(job.serverId);
    if (found.error) return found.error.message;
    if (!found.data) return "the MCP server for this step no longer exists";
    if (found.data.status !== "active") return "the MCP server for this step is disabled";
    if (!isFlowUsableClassification(found.data.dataClassification)) {
      return "this MCP server sends records outside Wayfinder and cannot run in a flow";
    }
    return found.data;
  }

  private async toolDescriptor(job: McpCallJob): Promise<ToolDescriptor> {
    const cached = await this.deps.tools.listByServer(job.serverId);
    const tool = cached.error ? undefined : cached.data.find((entry) => entry.name === job.toolName);
    if (!tool) return { title: job.toolName, settings: EMPTY_MCP_TOOL_SETTINGS };
    return {
      title: mcpToolDisplayTitle(tool),
      settings: { pagination: tool.pagination, status: tool.status, citation: tool.citation },
    };
  }

  private async nodeName(job: McpCallJob): Promise<string> {
    const found = await this.deps.flowNodes.findById(job.nodeId);
    return found.error || !found.data ? "MCP step" : found.data.name;
  }

  // Clears the pending execution through the same path a failed n8n callback
  // takes, so the step stops waiting and the session can move on.
  private async fail(job: McpCallJob, nodeName: string, reason: string): Promise<void> {
    await this.deps.applyResult.execute({
      sessionId: job.sessionId,
      correlationId: job.correlationId,
      nodeId: job.nodeId,
      status: "failed",
      data: {},
      message: reason,
    });
    await this.deps.queue.markFailed(job.id, reason);
    await this.postMessage(job, `This tool step (${nodeName}) could not run: ${reason}.`);
  }

  private async postMessage(job: McpCallJob, content: string): Promise<void> {
    const created = await this.deps.sessionMessages.create({
      sessionId: job.sessionId,
      role: "system",
      content,
      stepNodeId: job.nodeId,
    });
    if (!created.error && typeof created.data.seq === "number") {
      await this.publish(job.sessionId, { type: "message.created", seq: created.data.seq });
    }
    await this.publish(job.sessionId, { type: "session.updated" });
  }

  // A NOTIFY failure must never fail the call — the clients' fallback poll still
  // picks the change up.
  private async publish(sessionId: string, event: SessionEvent): Promise<void> {
    await this.deps.sessionEvents.publish(sessionId, event).catch(() => undefined);
  }
}
