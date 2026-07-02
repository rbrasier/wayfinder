import {
  domainError,
  err,
  ok,
  type FlowNode,
  type IMcpClient,
  type IMcpServerRepository,
  type ISessionRepository,
  type NodeExecutionOutput,
  type Result,
  type Session,
} from "@rbrasier/domain";

export interface ConfirmMcpNodeInput {
  session: Session;
  node: FlowNode;
  // Operator-edited arguments (ADR-032, Phase B). When present these replace the
  // parked arguments so what the operator sees and edits is exactly what runs.
  editedArgs?: Record<string, unknown>;
}

export interface ConfirmMcpNodeOutput {
  correlationId: string;
  status: NodeExecutionOutput["status"];
  // The tool result under the `output` key, matching RunMcpNode so the caller
  // applies it through the shared ApplyAutoNodeResult path.
  data: Record<string, unknown>;
  // True when the parked action had already been claimed (double Proceed / refresh).
  // The caller treats this as a benign no-op rather than firing the tool again.
  alreadyRan?: boolean;
}

// The operator-Proceed half of an MCP action node (ADR-032). Claims the parked
// execution (flipping it out of `awaiting_confirmation` so a second Proceed is a
// no-op — idempotency), then calls the AI-selected tool with the operator's edited
// arguments (or the parked ones) and returns the result for ApplyAutoNodeResult to
// persist and advance. Does not clear the awaiting flag or advance itself — the
// caller owns that so the confirmation and auto-advance side effects stay together.
export class ConfirmMcpNode {
  constructor(
    private readonly sessions: ISessionRepository,
    private readonly mcpServers: IMcpServerRepository,
    private readonly mcpClient: IMcpClient,
  ) {}

  async execute(input: ConfirmMcpNodeInput): Promise<Result<ConfirmMcpNodeOutput>> {
    const entry = Object.entries(input.session.pendingExecutions).find(
      ([, execution]) =>
        execution.nodeId === input.node.id && execution.status === "awaiting_confirmation",
    );
    if (!entry) {
      // Already claimed by a prior Proceed — nothing to run again.
      return ok({ correlationId: "", status: "completed", data: {}, alreadyRan: true });
    }
    const [correlationId, execution] = entry;

    const toolName = execution.toolName;
    if (!toolName) {
      return err(domainError("VALIDATION_FAILED", "The parked action has no tool to run."));
    }

    const serverResult = await this.mcpServers.findById(
      (input.node.config as { serverId?: string }).serverId ?? "",
    );
    if (serverResult.error) return err(serverResult.error);
    if (!serverResult.data) {
      return err(domainError("NOT_FOUND", "The MCP server for this step no longer exists."));
    }
    if (serverResult.data.status !== "active") {
      return err(domainError("VALIDATION_FAILED", "The MCP server for this step is disabled."));
    }

    const args = input.editedArgs ?? execution.args ?? {};

    // Claim the execution before calling the tool so a concurrent/duplicate Proceed
    // finds no awaiting entry and returns alreadyRan. Keep the correlationId (status
    // `pending`) so ApplyAutoNodeResult still finalizes it.
    const claimed = await this.sessions.update(input.session.id, {
      pendingExecutions: {
        ...input.session.pendingExecutions,
        [correlationId]: { ...execution, status: "pending", args },
      },
    });
    if (claimed.error) return err(claimed.error);

    const called = await this.mcpClient.callTool(serverResult.data, toolName, args);
    if (called.error) return err(called.error);

    return ok({
      correlationId,
      status: "completed",
      data: { output: called.data.output },
    });
  }
}
