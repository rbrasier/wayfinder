import {
  isUnattendedOrigin,
  ok,
  type FlowNode,
  type FlowNodeType,
  type IFlowRepository,
  type ISessionMessageRepository,
  type ISessionRepository,
  type ISessionStepOutputRepository,
  type Result,
  type Session,
} from "@rbrasier/domain";
import { resolveSessionGraph, type SessionGraphDependencies } from "../../services/resolve-session-graph";
import type { ISessionCompleteNotifier } from "../notifications/notify-on-session-complete";
import type { IUnattendedIncidentNotifier } from "../notifications/notify-unattended-incident";
import { runUnattendedStep, type StepOutcome, type UnattendedStepRunners } from "./unattended-step";

export type { UnattendedStepRunners } from "./unattended-step";

export interface AdvanceUnattendedRunDependencies {
  sessions: Pick<ISessionRepository, "findById" | "update" | "claimTurn" | "releaseTurn">;
  flows: Pick<IFlowRepository, "findById">;
  graph: SessionGraphDependencies;
  sessionMessages: Pick<ISessionMessageRepository, "listBySession">;
  sessionStepOutputs: Pick<ISessionStepOutputRepository, "listBySession">;
  steps: UnattendedStepRunners;
  // Whether the step type's feature flag is on for the run owner (ADR-065 §6a).
  isStepEnabled: (userId: string, nodeType: FlowNodeType) => Promise<boolean>;
  incidents: IUnattendedIncidentNotifier;
  sessionCompleteNotifier?: ISessionCompleteNotifier;
  newId: () => string;
  now: () => Date;
}

export interface AdvanceUnattendedRunInput {
  sessionId: string;
  // Set by the background sweeper: act only on a step the driver can run by
  // itself, never re-prepare a person's step or re-raise a request.
  resumeOnly?: boolean;
  // The chat turn that reached an unattended step already holds the session's
  // turn lease; claiming again would only find it taken.
  alreadyHoldsLease?: boolean;
}

export type AdvanceUnattendedRunOutput =
  | { status: "completed" | "busy" | "stopped" }
  | { status: "waiting" | "failed"; nodeId: string };

// Generous for a real flow, and the guard against an edge cycle through
// unattended steps spending tokens forever.
const MAX_STEPS_PER_CALL = 50;
const LEASE_SECONDS = 300;

const RESUMABLE_TYPES: readonly FlowNodeType[] = ["ai_task", "email", "auto", "mcp"];
const FLAG_GATED_LABELS: Partial<Record<FlowNodeType, string>> = {
  ai_task: "AI task",
  email: "Email",
  auto: "Automated",
  mcp: "MCP tool",
  scheduled: "Scheduled",
};

// Drives a session through every step that needs nobody, stopping at a person,
// a callback, a schedule, a fork or the end (ADR-065 §2). Safe to call again at
// any time: it holds the turn lease while it runs, never re-runs a step it has
// finished, and leaves a failed run alone until it is retried.
export class AdvanceUnattendedRun {
  constructor(private readonly dependencies: AdvanceUnattendedRunDependencies) {}

  async execute(input: AdvanceUnattendedRunInput): Promise<Result<AdvanceUnattendedRunOutput>> {
    const found = await this.dependencies.sessions.findById(input.sessionId);
    if (found.error) return found;
    if (!found.data || found.data.status !== "active") return ok({ status: "stopped" });
    if (input.alreadyHoldsLease) return this.drive(input);

    const turnId = this.dependencies.newId();
    const claim = await this.dependencies.sessions.claimTurn(
      input.sessionId,
      turnId,
      found.data.userId,
      LEASE_SECONDS,
    );
    if (claim.error) return claim;
    if (!claim.data.claimed) return ok({ status: "busy" });

    try {
      return await this.drive(input);
    } finally {
      await this.dependencies.sessions.releaseTurn(input.sessionId, turnId);
    }
  }

  private async drive(input: AdvanceUnattendedRunInput): Promise<Result<AdvanceUnattendedRunOutput>> {
    let lastNode: FlowNode | null = null;
    for (let step = 0; step < MAX_STEPS_PER_CALL; step++) {
      const found = await this.dependencies.sessions.findById(input.sessionId);
      if (found.error) return found;
      const session = found.data;
      if (!session || session.status !== "active") {
        return ok({ status: session?.status === "complete" ? "completed" : "stopped" });
      }
      if (session.runError) return ok({ status: "failed", nodeId: session.runError.nodeId });

      const graph = await resolveSessionGraph(session, this.dependencies.graph);
      if (graph.error) return graph;
      const node = graph.data.nodes.find((candidate) => candidate.id === session.currentNodeId);
      if (!node) return ok({ status: "stopped" });
      lastNode = node;

      // A finished step parked at a fork is the person's to move on.
      if (session.awaitingConfirmationNodeId === node.id) return ok({ status: "waiting", nodeId: node.id });
      if (input.resumeOnly && !RESUMABLE_TYPES.includes(node.type)) {
        return ok({ status: "waiting", nodeId: node.id });
      }

      const outcome = await this.runStep(session, node);
      if (outcome.kind === "failed") return this.fail(session, node, outcome.code, outcome.message);
      if (outcome.kind === "waiting") {
        if (outcome.needsPerson) await this.alertAwaitingPerson(session, node);
        return ok({ status: "waiting", nodeId: node.id });
      }
      if (outcome.kind === "moved") continue;

      const targets = graph.data.edges.filter((edge) => edge.fromNodeId === node.id).map((edge) => edge.toNodeId);
      const advanced = await this.advanceFrom(session, node, targets);
      if (advanced.error) return advanced;
      if (advanced.data === "completed") return ok({ status: "completed" });
      if (advanced.data === "parked") return ok({ status: "waiting", nodeId: node.id });
    }
    return this.failLooping(input.sessionId, lastNode);
  }

  private async failLooping(
    sessionId: string,
    lastNode: FlowNode | null,
  ): Promise<Result<AdvanceUnattendedRunOutput>> {
    const looping = await this.dependencies.sessions.findById(sessionId);
    if (looping.error) return looping;
    if (!looping.data || !lastNode) return ok({ status: "stopped" });
    return this.fail(
      looping.data,
      lastNode,
      "loop_limit",
      `The run took more than ${MAX_STEPS_PER_CALL} steps without stopping. Check the flow for a loop.`,
    );
  }

  private async runStep(session: Session, node: FlowNode): Promise<StepOutcome> {
    const gatedLabel = FLAG_GATED_LABELS[node.type];
    if (gatedLabel && !(await this.dependencies.isStepEnabled(session.userId, node.type))) {
      return {
        kind: "failed",
        code: "feature_disabled",
        message: `${gatedLabel} steps are disabled by an administrator`,
      };
    }

    const flow = await this.dependencies.flows.findById(session.flowId);
    if (flow.error) return { kind: "failed", code: flow.error.code, message: flow.error.message };
    if (!flow.data) return { kind: "failed", code: "flow_unavailable", message: "The flow no longer exists." };

    const [messages, outputs] = await Promise.all([
      this.dependencies.sessionMessages.listBySession(session.id),
      this.dependencies.sessionStepOutputs.listBySession(session.id),
    ]);
    return runUnattendedStep(this.dependencies.steps, {
      session,
      flow: flow.data,
      node,
      messages: messages.error ? [] : messages.data,
      priorStepOutputs: outputs.error ? [] : outputs.data,
    });
  }

  // Mirrors the other advance paths: no edge completes the run, one edge moves
  // on, several park the finished step for a person to choose the branch.
  private async advanceFrom(
    session: Session,
    node: FlowNode,
    targets: string[],
  ): Promise<Result<"completed" | "moved" | "parked">> {
    if (targets.length === 0) {
      const completed = await this.dependencies.sessions.update(session.id, { status: "complete" });
      if (completed.error) return completed;
      void this.dependencies.sessionCompleteNotifier?.execute({ session: completed.data }).catch(() => undefined);
      return ok("completed");
    }
    if (targets.length > 1) {
      const parked = await this.dependencies.sessions.update(session.id, { awaitingConfirmationNodeId: node.id });
      if (parked.error) return parked;
      await this.alertAwaitingPerson(session, node);
      return ok("parked");
    }
    const moved = await this.dependencies.sessions.update(session.id, {
      currentNodeId: targets[0]!,
      awaitingConfirmationNodeId: null,
      graphCheckpoint: { currentNodeId: targets[0]!, advancedFrom: node.id },
    });
    return moved.error ? moved : ok("moved");
  }

  private async alertAwaitingPerson(session: Session, node: FlowNode): Promise<void> {
    if (!isUnattendedOrigin(session.origin)) return;
    await this.dependencies.incidents.execute({
      kind: "awaiting_person",
      session,
      stepName: node.name || "a step",
      nodeId: node.id,
    });
  }

  private async fail(
    session: Session,
    node: FlowNode,
    code: string,
    message: string,
  ): Promise<Result<AdvanceUnattendedRunOutput>> {
    const incidentId = this.dependencies.newId();
    const recorded = await this.dependencies.sessions.update(session.id, {
      runError: { incidentId, nodeId: node.id, code, message, at: this.dependencies.now().toISOString() },
    });
    if (recorded.error) return recorded;
    await this.dependencies.incidents.execute({
      kind: "run_failed",
      session,
      stepName: node.name || "a step",
      reason: message,
      incidentId,
    });
    return ok({ status: "failed", nodeId: node.id });
  }
}
