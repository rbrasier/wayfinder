import {
  domainError,
  err,
  ok,
  type FlowNode,
  type IMcpClient,
  type IMcpServerRepository,
  type ISessionRepository,
  type McpNodeConfig,
  type NodeExecutionOutput,
  type Result,
  type Session,
} from "@rbrasier/domain";

export interface RunMcpNodeInput {
  session: Session;
  node: FlowNode;
  // The tool call the planner chose at the edge (ADR-032, Phase B).
  toolName: string;
  args: Record<string, unknown>;
}

export interface RunMcpNodeOutput {
  correlationId: string;
  status: NodeExecutionOutput["status"];
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

// The auto-fire path for a write MCP node with confirmation off (ADR-032). The tool
// call is planned at the edge; this records a pending execution, calls the tool, and
// returns a synchronous completion whose result the caller applies via
// ApplyAutoNodeResult.
export class RunMcpNode {
  constructor(
    private readonly sessions: ISessionRepository,
    private readonly mcpServers: IMcpServerRepository,
    private readonly mcpClient: IMcpClient,
    private readonly clock: RunMcpNodeClock = defaultClock,
  ) {}

  async execute(input: RunMcpNodeInput): Promise<Result<RunMcpNodeOutput>> {
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
      pendingExecutions: {
        ...input.session.pendingExecutions,
        [correlationId]: {
          nodeId: input.node.id,
          status: "pending",
          sentAt,
          toolName: input.toolName,
          args: input.args,
        },
      },
    });
    if (recorded.error) return err(recorded.error);

    const called = await this.mcpClient.callTool(serverResult.data, input.toolName, input.args);
    if (called.error) return err(called.error);

    return ok({
      correlationId,
      status: "completed",
      data: { output: called.data.output },
    });
  }
}
