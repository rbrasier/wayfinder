import {
  domainError,
  err,
  ok,
  type Flow,
  type FlowNode,
  type ILanguageModel,
  type IMcpClient,
  type IMcpServerRepository,
  type ISessionRepository,
  type ISessionStepOutputRepository,
  type McpNodeConfig,
  type NodeExecutionOutput,
  type Result,
  type Session,
  type SessionMessage,
} from "@rbrasier/domain";
import { accumulateInsights } from "../../services/accumulate-insights";
import { resolveFieldValues } from "../../services/resolve-field-values";

export interface RunMcpNodeInput {
  session: Session;
  flow: Flow;
  node: FlowNode;
  messages: SessionMessage[];
  userId: string;
}

export interface RunMcpNodeOutput {
  correlationId: string;
  status: NodeExecutionOutput["status"];
  message?: string;
  // The tool result is exposed under the `output` key, so a response field with
  // key `output` captures it (ADR-032). Synchronous — always "completed" on success.
  data: Record<string, unknown>;
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

// A deterministic single-tool MCP call (ADR-032). Mirrors RunAutoNode: resolves
// request fields, records a pending execution, calls the tool, and returns a
// synchronous completion whose result the caller applies via ApplyAutoNodeResult.
export class RunMcpNode {
  constructor(
    private readonly sessions: ISessionRepository,
    private readonly languageModel: ILanguageModel,
    private readonly mcpServers: IMcpServerRepository,
    private readonly mcpClient: IMcpClient,
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
    // Backstop: externally-communicating servers are not permitted in flows at
    // this stage, even if an older node config still references one.
    if (serverResult.data.communicatesExternally) {
      return err(
        domainError("VALIDATION_FAILED", "This MCP server communicates outside Wayfinder and cannot run in a flow."),
      );
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

    const called = await this.mcpClient.callTool(serverResult.data, config.toolName, fieldsResult.data);
    // The call is synchronous, so a failure leaves nothing for a callback to
    // clear — ApplyAutoNodeResult only runs on the success path. Drop the pending
    // entry here or it accumulates on the session forever.
    if (called.error) {
      await this.clearPending(input.session.id, correlationId);
      return err(called.error);
    }

    return ok({
      correlationId,
      status: "completed",
      data: { output: called.data.output },
    });
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
