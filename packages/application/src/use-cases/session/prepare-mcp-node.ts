import {
  domainError,
  err,
  ok,
  type FlowNode,
  type IMcpServerRepository,
  type ISessionRepository,
  type McpNodeConfig,
  type Result,
  type Session,
} from "@rbrasier/domain";

export interface PrepareMcpNodeInput {
  session: Session;
  node: FlowNode;
  // The tool call the planner chose at the edge (ADR-032, Phase B). Parked as-is so
  // the operator previews and edits exactly what will run.
  toolName: string;
  args: Record<string, unknown>;
}

export interface PrepareMcpNodeOutput {
  correlationId: string;
  toolName: string;
  serverLabel: string;
  args: Record<string, unknown>;
}

export interface PrepareMcpNodeClock {
  generateCorrelationId: () => string;
  now: () => Date;
}

const defaultClock: PrepareMcpNodeClock = {
  generateCorrelationId: () => globalThis.crypto.randomUUID(),
  now: () => new Date(),
};

// The human-in-the-loop half of an MCP action node (ADR-032). The AI-selected tool
// call is planned at the edge; this use-case parks it on the session as an
// `awaiting_confirmation` pending execution and flags the node on
// `awaitingConfirmationNodeId`. ConfirmMcpNode fires the actual call once the
// operator clicks Proceed (optionally with edited arguments).
export class PrepareMcpNode {
  constructor(
    private readonly sessions: ISessionRepository,
    private readonly mcpServers: IMcpServerRepository,
    private readonly clock: PrepareMcpNodeClock = defaultClock,
  ) {}

  async execute(input: PrepareMcpNodeInput): Promise<Result<PrepareMcpNodeOutput>> {
    const config = input.node.config as unknown as McpNodeConfig;
    if (!config.serverId) {
      return err(domainError("VALIDATION_FAILED", "MCP node has no server configured."));
    }

    const serverResult = await this.mcpServers.findById(config.serverId);
    if (serverResult.error) return err(serverResult.error);
    if (!serverResult.data) {
      return err(domainError("NOT_FOUND", "The MCP server for this step no longer exists."));
    }
    if (serverResult.data.status !== "active") {
      return err(domainError("VALIDATION_FAILED", "The MCP server for this step is disabled."));
    }

    const correlationId = this.clock.generateCorrelationId();
    const sentAt = this.clock.now().toISOString();

    const recorded = await this.sessions.update(input.session.id, {
      awaitingConfirmationNodeId: input.node.id,
      pendingExecutions: {
        ...input.session.pendingExecutions,
        [correlationId]: {
          nodeId: input.node.id,
          status: "awaiting_confirmation",
          sentAt,
          toolName: input.toolName,
          args: input.args,
        },
      },
    });
    if (recorded.error) return err(recorded.error);

    return ok({
      correlationId,
      toolName: input.toolName,
      serverLabel: serverResult.data.label,
      args: input.args,
    });
  }
}
