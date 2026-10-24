import {
  deriveRunStatus,
  ok,
  type IApprovalRepository,
  type IUnattendedRunRepository,
  type Result,
  type Session,
  type UnattendedRunStatus,
} from "@rbrasier/domain";
import { resolveSessionGraph, type SessionGraphDependencies } from "../../services/resolve-session-graph";

export interface ListTriggerRunsDependencies {
  runs: Pick<IUnattendedRunRepository, "listByTriggerSource">;
  graph: SessionGraphDependencies;
  approvals: Pick<IApprovalRepository, "findPendingByNode">;
}

export interface TriggerRunSummary {
  sessionId: string;
  title: string | null;
  status: UnattendedRunStatus;
  currentStepName: string | null;
  error: string | null;
  startedAt: Date;
  updatedAt: Date;
}

// Run history for one watch or webhook (ADR-065 §7). Statuses are derived on
// read, never stored, so they cannot drift from the sessions they describe.
export class ListTriggerRuns {
  constructor(private readonly dependencies: ListTriggerRunsDependencies) {}

  async execute(input: { sourceId: string; limit: number }): Promise<Result<TriggerRunSummary[]>> {
    const sessions = await this.dependencies.runs.listByTriggerSource(input.sourceId, input.limit);
    if (sessions.error) return sessions;
    const summaries = await Promise.all(sessions.data.map((session) => this.summarise(session)));
    return ok(summaries);
  }

  private async summarise(session: Session): Promise<TriggerRunSummary> {
    const graph = await resolveSessionGraph(session, this.dependencies.graph);
    const node = graph.error
      ? undefined
      : graph.data.nodes.find((candidate) => candidate.id === session.currentNodeId);
    const pending =
      node?.type === "ai_task" && session.status === "active"
        ? await this.dependencies.approvals.findPendingByNode(session.id, node.id)
        : null;

    return {
      sessionId: session.id,
      title: session.title,
      status: deriveRunStatus({
        sessionStatus: session.status,
        runError: session.runError,
        currentNodeType: node?.type ?? null,
        hasPendingReview: Boolean(pending && !pending.error && pending.data),
      }),
      currentStepName: node?.name ?? null,
      error: session.runError?.message ?? null,
      startedAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }
}
