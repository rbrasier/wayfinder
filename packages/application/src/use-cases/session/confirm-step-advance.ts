import {
  domainError,
  err,
  flowEdgesFromSnapshot,
  ok,
  type FlowEdge,
  type IFlowEdgeRepository,
  type IFlowVersionRepository,
  type ISessionRepository,
  type Result,
  type Session,
} from "@rbrasier/domain";
import type { ISessionStepCompleteNotifier } from "../notifications/notify-on-step-complete";

export interface ConfirmStepAdvanceInput {
  sessionId: string;
  // The node the operator clicked Proceed on. Guards against confirming a step
  // the session has already advanced past in a collaborative race.
  nodeId: string;
  // Branch recomputed at confirm time by the caller (one model call on a fork),
  // mirroring how RunTurn receives its branch choice. Null on a single edge.
  branchChoice: string | null;
  confirmedByUserId: string;
}

export interface ConfirmStepAdvanceOutput {
  session: Session;
  advanced: boolean;
  newNodeId: string | null;
  // A fork the branch choice could not resolve — the caller surfaces the manual
  // branch-override path. The awaiting flag is left set so the card stays.
  needsManualBranch: boolean;
}

// Performs the deferred advancement when an operator confirms a step that was
// held open by `requireConfirmation`. Mirrors RunTurn's advancement block so a
// confirmed step produces an outcome identical to auto-advance (ADR-026).
export class ConfirmStepAdvance {
  constructor(
    private readonly sessions: ISessionRepository,
    private readonly flowEdges: IFlowEdgeRepository,
    private readonly flowVersions?: IFlowVersionRepository,
    private readonly sessionStepCompleteNotifier?: ISessionStepCompleteNotifier,
  ) {}

  async execute(input: ConfirmStepAdvanceInput): Promise<Result<ConfirmStepAdvanceOutput>> {
    const sessionResult = await this.sessions.findById(input.sessionId);
    if (sessionResult.error) return sessionResult;
    if (!sessionResult.data) {
      return err(domainError("NOT_FOUND", "Session not found."));
    }

    const session = sessionResult.data;

    // No-op when the session is not genuinely awaiting this node — covers the
    // collaborative double-Proceed race once the first Proceed has advanced.
    const isAwaitingThisNode =
      session.awaitingConfirmationNodeId === input.nodeId &&
      session.currentNodeId === input.nodeId;
    if (!isAwaitingThisNode) {
      return ok({ session, advanced: false, newNodeId: null, needsManualBranch: false });
    }

    const edgesResult = await this.resolveEdges(session, session.flowId);
    if (edgesResult.error) return edgesResult;

    const outgoing = edgesResult.data.filter((e) => e.fromNodeId === session.currentNodeId);
    const completedNodeId = session.currentNodeId;

    if (outgoing.length === 0) {
      const updated = await this.sessions.update(session.id, {
        status: "complete",
        awaitingConfirmationNodeId: null,
        graphCheckpoint: {
          currentNodeId: session.currentNodeId,
          confirmedByUserId: input.confirmedByUserId,
          confirmedAt: new Date().toISOString(),
        },
      });
      if (updated.error) return updated;
      this.notifyStepComplete(updated.data, completedNodeId);
      return ok({ session: updated.data, advanced: true, newNodeId: null, needsManualBranch: false });
    }

    let newNodeId: string | null = null;
    if (outgoing.length === 1) {
      newNodeId = outgoing[0]!.toNodeId;
    } else if (input.branchChoice) {
      const edge = outgoing.find((e) => e.toNodeId === input.branchChoice);
      newNodeId = edge?.toNodeId ?? null;
    }

    if (!newNodeId) {
      return ok({ session, advanced: false, newNodeId: null, needsManualBranch: true });
    }

    const updated = await this.sessions.update(session.id, {
      currentNodeId: newNodeId,
      awaitingConfirmationNodeId: null,
      graphCheckpoint: {
        currentNodeId: newNodeId,
        advancedFrom: session.currentNodeId,
        confirmedByUserId: input.confirmedByUserId,
        confirmedAt: new Date().toISOString(),
      },
    });
    if (updated.error) return updated;

    this.notifyStepComplete(updated.data, completedNodeId);
    return ok({ session: updated.data, advanced: true, newNodeId, needsManualBranch: false });
  }

  // Advancement follows the pinned snapshot's edges when the chat is pinned, so
  // a later edit/publish/restore cannot reroute an in-progress chat. Falls back
  // to the live edges for unpinned sessions. Mirrors RunTurn.resolveEdges.
  private async resolveEdges(session: Session, flowId: string): Promise<Result<FlowEdge[]>> {
    if (session.flowVersionId && this.flowVersions) {
      const versionResult = await this.flowVersions.getById(session.flowVersionId);
      if (versionResult.error) return versionResult;
      if (versionResult.data) {
        const version = versionResult.data;
        return ok(flowEdgesFromSnapshot(flowId, version.snapshot, version.createdAt));
      }
    }
    return this.flowEdges.listByFlow(flowId);
  }

  private notifyStepComplete(session: Session, completedNodeId: string | null): void {
    if (!completedNodeId) return;
    void this.sessionStepCompleteNotifier
      ?.execute({ session, completedNodeId })
      .catch(() => undefined);
  }
}
