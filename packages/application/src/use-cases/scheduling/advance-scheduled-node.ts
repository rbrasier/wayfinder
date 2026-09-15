import {
  ok,
  type IFlowEdgeRepository,
  type ISessionRepository,
  type Result,
  type Session,
} from "@wayfinder/domain";
import type { ISessionCompleteNotifier } from "../notifications/notify-on-session-complete";
import type { ISessionStepCompleteNotifier } from "../notifications/notify-on-step-complete";

export type AdvanceScheduledNodeStatus =
  | "advanced"
  | "completed"
  | "needs_branch_choice"
  | "stale";

export interface AdvanceScheduledNodeInput {
  sessionId: string;
  scheduledNodeId: string;
  // The chosen next node id when the scheduled node forks. Resolved by the
  // caller (the web fire handler runs the branch-choice model); the use case
  // only validates and commits it.
  branchChoice?: string | null;
}

export interface AdvanceScheduledNodeOutput {
  status: AdvanceScheduledNodeStatus;
  session: Session | null;
  newNodeId: string | null;
  // Candidate next nodes when status is `needs_branch_choice`.
  branchNodeIds: string[];
}

const stale: AdvanceScheduledNodeOutput = {
  status: "stale",
  session: null,
  newNodeId: null,
  branchNodeIds: [],
};

// Advances a session that is parked on a fired scheduled node to the next node,
// mirroring the transition rules of a completed conversational turn but without
// persisting an assistant message. Branch selection at a fork is delegated to
// the caller via `branchChoice`.
export class AdvanceScheduledNode {
  constructor(
    private readonly sessions: ISessionRepository,
    private readonly flowEdges: IFlowEdgeRepository,
    private readonly sessionCompleteNotifier?: ISessionCompleteNotifier,
    private readonly sessionStepCompleteNotifier?: ISessionStepCompleteNotifier,
  ) {}

  async execute(input: AdvanceScheduledNodeInput): Promise<Result<AdvanceScheduledNodeOutput>> {
    const sessionResult = await this.sessions.findById(input.sessionId);
    if (sessionResult.error) return sessionResult;

    const session = sessionResult.data;
    // The schedule may have outlived its usefulness: the session was completed,
    // abandoned, or manually moved on. Firing is then a no-op, never an error.
    if (!session || session.status !== "active" || session.currentNodeId !== input.scheduledNodeId) {
      return ok(stale);
    }

    const edgesResult = await this.flowEdges.listByFlow(session.flowId);
    if (edgesResult.error) return edgesResult;

    // The scheduled node has fired, so the step is complete here regardless of
    // whether the session then advances, completes, or parks at a fork.
    void this.sessionStepCompleteNotifier
      ?.execute({ session, completedNodeId: input.scheduledNodeId })
      .catch(() => undefined);

    const outgoing = edgesResult.data.filter((edge) => edge.fromNodeId === input.scheduledNodeId);

    if (outgoing.length === 0) {
      const completed = await this.sessions.update(session.id, { status: "complete" });
      if (completed.error) return completed;
      // Fire-and-forget so a slow SMTP server can never stall the fire; the
      // notifier records its own outcome in the outbox and never throws.
      void this.sessionCompleteNotifier?.execute({ session: completed.data }).catch(() => undefined);
      return ok({ status: "completed", session: completed.data, newNodeId: null, branchNodeIds: [] });
    }

    const newNodeId = this.resolveNextNode(outgoing, input.branchChoice);
    if (!newNodeId) {
      return ok({
        status: "needs_branch_choice",
        session,
        newNodeId: null,
        branchNodeIds: outgoing.map((edge) => edge.toNodeId),
      });
    }

    const updated = await this.sessions.update(session.id, {
      currentNodeId: newNodeId,
      graphCheckpoint: { currentNodeId: newNodeId, advancedFrom: input.scheduledNodeId },
    });
    if (updated.error) return updated;

    return ok({ status: "advanced", session: updated.data, newNodeId, branchNodeIds: [] });
  }

  private resolveNextNode(
    outgoing: { toNodeId: string }[],
    branchChoice: string | null | undefined,
  ): string | null {
    if (outgoing.length === 1) return outgoing[0]!.toNodeId;
    if (branchChoice && outgoing.some((edge) => edge.toNodeId === branchChoice)) return branchChoice;
    return null;
  }
}
