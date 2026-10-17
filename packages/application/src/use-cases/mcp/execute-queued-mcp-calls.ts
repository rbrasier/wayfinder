import {
  EMPTY_MCP_TOOL_SETTINGS,
  err,
  isFlowUsableClassification,
  MAX_MCP_CALL_TIMEOUT_MS,
  mcpToolDisplayTitle,
  ok,
  type IFlowNodeRepository,
  type IMcpCallQueue,
  type IMcpClient,
  type IMcpServerRepository,
  type IMcpToolRepository,
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

const DEFAULT_BATCH_SIZE = 5;
// How often a still-running call re-announces itself, so the person waiting sees
// the elapsed time move rather than a frozen label (ADR-062 §4).
const PROGRESS_HEARTBEAT_MS = 5_000;
// A running row older than the longest allowed call plus a grace period belongs
// to a worker that died mid-call; nothing else will ever finish it.
const STALE_AFTER_MS = MAX_MCP_CALL_TIMEOUT_MS + 60_000;

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
  batchSize?: number;
}

export interface ExecuteQueuedMcpCallsOutput {
  processed: number;
  failedStale: number;
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
// worker abandoned, then claims a batch and runs it concurrently — each call
// can take tens of seconds, so running them one after another would make the
// last in the batch wait for all the others.
export class ExecuteQueuedMcpCalls {
  private readonly clock: { now(): Date };

  constructor(private readonly deps: ExecuteQueuedMcpCallsDeps) {
    this.clock = deps.clock ?? { now: () => new Date() };
  }

  async execute(): Promise<Result<ExecuteQueuedMcpCallsOutput>> {
    const staleBefore = new Date(this.clock.now().getTime() - STALE_AFTER_MS);
    const stale = await this.deps.queue.listStaleRunning(staleBefore);
    if (stale.error) return err(stale.error);
    for (const job of stale.data) {
      await this.fail(job, await this.nodeName(job), "the call did not finish");
    }

    const claimed = await this.deps.queue.claimPending(this.deps.batchSize ?? DEFAULT_BATCH_SIZE);
    if (claimed.error) return err(claimed.error);
    await Promise.all(claimed.data.map((job) => this.run(job)));

    return ok({ processed: claimed.data.length, failedStale: stale.data.length });
  }

  private async run(job: McpCallJob): Promise<void> {
    const nodeName = await this.nodeName(job);
    const server = await this.usableServer(job);
    if (typeof server === "string") {
      await this.fail(job, nodeName, server);
      return;
    }

    const tool = await this.toolDescriptor(job);
    const progress = this.startProgress(job, server, tool.title);
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
    await progress.stop();

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

  private startProgress(job: McpCallJob, server: McpServer, toolTitle: string) {
    const startedAt = this.clock.now().getTime();
    let currentPage = 1;
    const publish = (state: "running" | "done") =>
      this.publish(job.sessionId, {
        type: "tool.progress",
        callId: job.id,
        toolTitle,
        serverLabel: server.label,
        page: currentPage,
        elapsedMs: this.clock.now().getTime() - startedAt,
        state,
      });

    publish("running");
    const heartbeat = setInterval(() => publish("running"), PROGRESS_HEARTBEAT_MS);
    return {
      page: (page: number) => {
        if (page <= currentPage) return;
        currentPage = page;
        publish("running");
      },
      stop: async () => {
        clearInterval(heartbeat);
        await publish("done");
      },
    };
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
