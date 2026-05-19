import {
  domainError,
  err,
  ok,
  type IFlowEdgeRepository,
  type ISessionRepository,
  type Result,
  type Session,
} from "@rbrasier/domain";

export interface OverrideBranchInput {
  sessionId: string;
  targetNodeId: string;
}

export class OverrideBranch {
  constructor(
    private readonly sessions: ISessionRepository,
    private readonly flowEdges: IFlowEdgeRepository,
  ) {}

  async execute(input: OverrideBranchInput): Promise<Result<Session>> {
    const sessionResult = await this.sessions.findById(input.sessionId);
    if (sessionResult.error) return sessionResult;
    if (!sessionResult.data) {
      return err(domainError("NOT_FOUND", "Session not found."));
    }

    const session = sessionResult.data;

    const edgesResult = await this.flowEdges.listByFlow(session.flowId);
    if (edgesResult.error) return edgesResult;

    const outgoing = edgesResult.data.filter((e) => e.fromNodeId === session.currentNodeId);
    const targetEdge = outgoing.find((e) => e.toNodeId === input.targetNodeId);

    if (!targetEdge) {
      return err(domainError("VALIDATION_FAILED", "Target node is not a valid branch from the current node."));
    }

    const updated = await this.sessions.update(session.id, {
      currentNodeId: input.targetNodeId,
      graphCheckpoint: {
        currentNodeId: input.targetNodeId,
        advancedFrom: session.currentNodeId,
        manualOverride: true,
      },
    });
    if (updated.error) return updated;

    return ok(updated.data);
  }
}
