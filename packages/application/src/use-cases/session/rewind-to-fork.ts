import {
  abandonedBranchNodeIds,
  domainError,
  err,
  isSessionDiscarded,
  ok,
  visitedNodeIdsInOrder,
  type FlowEdge,
  type FlowNode,
  type ISessionMessageRepository,
  type ISessionRepository,
  type Result,
  type Session,
} from "@rbrasier/domain";

export interface RewindToForkInput {
  sessionId: string;
  // The fork the session is being sent back to. Must be a step it has stood on.
  forkNodeId: string;
  // The branch to take instead. Must leave `forkNodeId`.
  targetNodeId: string;
  // The graph as the operator saw it. Passed in rather than read from the live
  // rows because a session renders the flow version it is pinned to (ADR-015);
  // validating against anything else could reject a fork that is on screen.
  nodes: readonly FlowNode[];
  edges: readonly FlowEdge[];
}

export interface RewindToForkResult {
  session: Session;
  // Steps that belonged only to the branch just left. The step rail stops
  // showing these as complete; their messages, and so their insights, remain.
  abandonedNodeIds: string[];
}

const nameOf = (nodes: readonly FlowNode[], nodeId: string): string =>
  nodes.find((node) => node.id === nodeId)?.name ?? "this step";

/**
 * Sends a session back to a fork it already passed and down a different branch,
 * for when the routing decision was wrong.
 *
 * Deliberately non-destructive: no message, step output or document is removed.
 * Insights are derived from the transcript, so leaving it whole is what carries
 * the work done on the abandoned branch onto the new one.
 */
export class RewindToFork {
  constructor(
    private readonly sessions: ISessionRepository,
    private readonly sessionMessages: ISessionMessageRepository,
  ) {}

  async execute(input: RewindToForkInput): Promise<Result<RewindToForkResult>> {
    const sessionResult = await this.sessions.findById(input.sessionId);
    if (sessionResult.error) return sessionResult;
    if (!sessionResult.data) {
      return err(domainError("NOT_FOUND", "Session not found."));
    }

    const session = sessionResult.data;
    if (session.status !== "active") {
      const reason = isSessionDiscarded(session.status) ? "is no longer running" : "has finished";
      return err(domainError("VALIDATION_FAILED", `This chat ${reason}, so it cannot be rewound.`));
    }

    const outgoing = input.edges.filter((edge) => edge.fromNodeId === input.forkNodeId);
    if (outgoing.length <= 1) {
      return err(domainError("VALIDATION_FAILED", "That step is not a fork — it has only one next step."));
    }
    if (!outgoing.some((edge) => edge.toNodeId === input.targetNodeId)) {
      return err(domainError("VALIDATION_FAILED", "That step is not a branch of the chosen fork."));
    }

    const messagesResult = await this.sessionMessages.listBySession(input.sessionId);
    if (messagesResult.error) return messagesResult;

    const visited = visitedNodeIdsInOrder(messagesResult.data, session.currentNodeId);
    if (!visited.includes(input.forkNodeId)) {
      return err(domainError("VALIDATION_FAILED", "This chat has not reached that fork."));
    }

    const takenNodeId = this.takenBranch(outgoing, visited);
    if (!takenNodeId) {
      return err(
        domainError("VALIDATION_FAILED", "This chat has not taken a branch at that fork yet."),
      );
    }

    const rewind = {
      forkNodeId: input.forkNodeId,
      fromNodeId: takenNodeId,
      toNodeId: input.targetNodeId,
    };
    const abandoned = abandonedBranchNodeIds([...input.edges], rewind, visited);

    const updated = await this.sessions.update(session.id, {
      currentNodeId: input.targetNodeId,
      // The step that was awaiting Proceed is not where the session sits any
      // more, so the hold has nothing left to release.
      awaitingConfirmationNodeId: null,
      graphCheckpoint: {
        currentNodeId: input.targetNodeId,
        advancedFrom: input.forkNodeId,
        rewind: { ...rewind, at: new Date().toISOString() },
        abandonedNodeIds: abandoned,
      },
    });
    if (updated.error) return updated;

    await this.recordInTranscript(input, rewind.fromNodeId);

    return ok({ session: updated.data, abandonedNodeIds: abandoned });
  }

  // The branch the session actually went down: the fork's target it visited most
  // recently. `visited` is ordered by latest visit, so the highest index wins —
  // a fork worked twice reports the branch taken the second time.
  private takenBranch(outgoing: readonly FlowEdge[], visited: readonly string[]): string | null {
    let taken: string | null = null;
    let latest = -1;
    for (const edge of outgoing) {
      const position = visited.indexOf(edge.toNodeId);
      if (position > latest) {
        latest = position;
        taken = edge.toNodeId;
      }
    }
    return latest === -1 ? null : taken;
  }

  // Best-effort: the session has already moved, and failing to narrate the move
  // must not undo it. The note is what tells the next turn — and the operator
  // reading back — that the earlier branch's answers were gathered elsewhere.
  private async recordInTranscript(input: RewindToForkInput, fromNodeId: string): Promise<void> {
    await this.sessionMessages.create({
      sessionId: input.sessionId,
      role: "system",
      content:
        `We've gone back to "${nameOf(input.nodes, input.forkNodeId)}" and switched from ` +
        `"${nameOf(input.nodes, fromNodeId)}" to "${nameOf(input.nodes, input.targetNodeId)}". ` +
        "Everything gathered so far still applies — just let me know how you'd like to proceed.",
      stepNodeId: input.targetNodeId,
    });
  }
}
