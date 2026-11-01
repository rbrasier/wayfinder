import {
  domainError,
  err,
  isFlowUsableClassification,
  ok,
  verbatimTransformViolations,
  type Flow,
  type FlowNode,
  type ILanguageModel,
  type IMcpCallQueue,
  type IMcpServerRepository,
  type ISessionRepository,
  type ISessionStepOutputRepository,
  type McpNodeConfig,
  type NodeExecutionOutput,
  type Result,
  type Session,
  type SessionMessage,
} from "@wayfinder/domain";
import { accumulateInsights } from "../../services/accumulate-insights";
import { resolveFieldValues } from "../../services/resolve-field-values";

export interface RunMcpNodeInput {
  session: Session;
  flow: Flow;
  node: FlowNode;
  messages: SessionMessage[];
  userId: string;
}

// The call itself is queued (ADR-062 §3): the worker makes it and applies the
// result — the tool's text under the `output` key, persisted verbatim when the
// server is verbatim-only (ADR-053 §5) — so this turn never waits on the source.
export interface RunMcpNodeOutput {
  correlationId: string;
  jobId: string;
  status: Extract<NodeExecutionOutput["status"], "pending">;
}

export interface RunMcpNodeClock {
  generateCorrelationId: () => string;
  now: () => Date;
}

const defaultClock: RunMcpNodeClock = {
  generateCorrelationId: () => globalThis.crypto.randomUUID(),
  now: () => new Date(),
};

const buildTranscript = (messages: SessionMessage[]): string =>
  messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`)
    .join("\n\n")
    .slice(0, 8000);

// A deterministic single-tool MCP call. Mirrors RunAutoNode: resolves request
// fields, records a pending execution and queues the call; ExecuteQueuedMcpCalls
// makes it and applies the result via ApplyAutoNodeResult (ADR-062 §3).
export class RunMcpNode {
  constructor(
    private readonly sessions: ISessionRepository,
    private readonly languageModel: ILanguageModel,
    private readonly mcpServers: IMcpServerRepository,
    private readonly mcpCallQueue: IMcpCallQueue,
    private readonly sessionStepOutputs: ISessionStepOutputRepository,
    private readonly clock: RunMcpNodeClock = defaultClock,
  ) {}

  async execute(input: RunMcpNodeInput): Promise<Result<RunMcpNodeOutput>> {
    const config = input.node.config as unknown as McpNodeConfig;

    if (!config.serverId || !config.toolName) {
      return err(domainError("VALIDATION_FAILED", "MCP node has no server or tool configured."));
    }

    const serverResult = await this.mcpServers.findById(config.serverId);
    if (serverResult.error) return err(serverResult.error);
    if (!serverResult.data) {
      return err(domainError("NOT_FOUND", "The MCP server for this step no longer exists."));
    }
    if (serverResult.data.status !== "active") {
      return err(domainError("VALIDATION_FAILED", "The MCP server for this step is disabled."));
    }
    // Backstop: a server that sends records out is never permitted in a flow
    // (ADR-062 §1), even if an older node config still references one.
    if (!isFlowUsableClassification(serverResult.data.dataClassification)) {
      return err(
        domainError("VALIDATION_FAILED", "This MCP server sends records outside Wayfinder and cannot run in a flow."),
      );
    }
    // Backstop for the publish-time gate: a verbatim-only connection may not be
    // run by a step whose response fields cannot return what the tool sent.
    // Refused before the call is queued so a governed source is never even queried
    // by a step that would then reshape its answer.
    if (serverResult.data.verbatimOnly) {
      const violations = verbatimTransformViolations(config.responseFields ?? []);
      if (violations.length > 0) {
        return err(
          domainError(
            "VALIDATION_FAILED",
            `This MCP server is set to verbatim-only handling, so this step cannot transform its results: ${violations.join("; ")}.`,
          ),
        );
      }
    }

    const priorOutputs = await this.sessionStepOutputs.listBySession(input.session.id);
    const fieldsResult = await resolveFieldValues(this.languageModel, {
      fields: config.requestFields ?? [],
      valueSources: config.requestFieldValues ?? {},
      priorStepOutputs: priorOutputs.error ? [] : priorOutputs.data,
      insights: accumulateInsights(input.messages),
      transcript: buildTranscript(input.messages),
      contextDocs: input.flow.contextDocs,
      instruction: config.instruction,
      purpose: "mcpNodeFields",
      userId: input.userId,
      flowId: input.flow.id,
      sessionId: input.session.id,
    });
    if (fieldsResult.error) return err(fieldsResult.error);

    const correlationId = this.clock.generateCorrelationId();
    const sentAt = this.clock.now().toISOString();

    const recorded = await this.sessions.update(input.session.id, {
      pendingExecutions: {
        ...input.session.pendingExecutions,
        [correlationId]: { nodeId: input.node.id, status: "pending", sentAt },
      },
    });
    if (recorded.error) return err(recorded.error);

    const queued = await this.mcpCallQueue.enqueue({
      sessionId: input.session.id,
      flowId: input.flow.id,
      nodeId: input.node.id,
      correlationId,
      serverId: serverResult.data.id,
      toolName: config.toolName,
      arguments: fieldsResult.data,
      actorId: input.userId,
    });
    // Nothing will ever run a call that was never queued, so nothing would ever
    // clear its pending entry. Drop it here or it holds the step forever.
    if (queued.error) {
      await this.clearPending(input.session.id, correlationId);
      return err(queued.error);
    }

    return ok({ correlationId, jobId: queued.data.id, status: "pending" });
  }

  // Best-effort removal of a single pending execution. Re-reads so it modifies the
  // latest blob rather than the possibly-stale snapshot on the input session, and
  // never surfaces its own error — the caller returns the original tool failure.
  private async clearPending(sessionId: string, correlationId: string): Promise<void> {
    const current = await this.sessions.findById(sessionId);
    if (current.error || !current.data) return;
    const remaining = { ...current.data.pendingExecutions };
    delete remaining[correlationId];
    await this.sessions.update(sessionId, { pendingExecutions: remaining });
  }
}
