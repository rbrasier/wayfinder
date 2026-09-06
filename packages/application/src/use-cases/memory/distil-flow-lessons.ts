import {
  err,
  lessonsToRetire,
  ok,
  type FlowObservation,
  type IAuditLogger,
  type IFlowLessonRepository,
  type IFlowNodeRepository,
  type IFlowObservationRepository,
  type ILessonDistiller,
  type LessonKind,
  type ObservationKind,
  type Result,
} from "@rbrasier/domain";

// Which lesson kind a signal becomes. `knowledge_gap` is its own kind because it
// routes to the knowledge base rather than to a prompt (ADR-057 §6); the
// efficiency signals are about how much work the step took, not what it said.
const LESSON_KIND_BY_OBSERVATION: Record<ObservationKind, LessonKind> = {
  field_corrected: "guidance",
  low_confidence_completion: "guidance",
  change_requested: "guidance",
  abandoned_at_step: "guidance",
  excess_turns: "efficiency",
  redundant_question: "efficiency",
  knowledge_gap: "knowledge_gap",
};

export interface DistilFlowLessonsInput {
  flowId: string;
  evidenceThreshold: number;
  observationLimit?: number;
}

export interface DistillationOutcome {
  proposed: number;
  retired: number;
  // Candidates the model returned that were not written, with the reason. These
  // are reported rather than materialised, per `032`'s propose/validate/confirm
  // shape.
  rejected: { statement: string; reason: string }[];
}

const groupKey = (observation: FlowObservation): string =>
  `${observation.nodeId}::${observation.kind}`;

export class DistilFlowLessons {
  constructor(
    private readonly observations: IFlowObservationRepository,
    private readonly lessons: IFlowLessonRepository,
    private readonly distiller: ILessonDistiller,
    private readonly flowNodes: IFlowNodeRepository,
    private readonly auditLogger: IAuditLogger,
  ) {}

  async execute(input: DistilFlowLessonsInput): Promise<Result<DistillationOutcome>> {
    const undistilled = await this.observations.listUndistilledByFlow(
      input.flowId,
      input.observationLimit ?? 500,
    );
    if (undistilled.error) return err(undistilled.error);

    // Nodes come from the live flow, not the pinned snapshot: a lesson binds to a
    // node that still exists, and one whose node is gone is retired (ADR-058 §2).
    const nodesResult = await this.flowNodes.listByFlow(input.flowId);
    if (nodesResult.error) return err(nodesResult.error);

    const existingResult = await this.lessons.listByFlow(input.flowId);
    if (existingResult.error) return err(existingResult.error);

    const nodesById = new Map(nodesResult.data.map((node) => [node.id, node]));
    const outcome: DistillationOutcome = { proposed: 0, retired: 0, rejected: [] };

    for (const [key, group] of this.groupsAboveThreshold(undistilled.data, input.evidenceThreshold)) {
      const [nodeId, kind] = key.split("::") as [string, ObservationKind];
      const node = nodesById.get(nodeId);
      // The node was deleted between capture and distillation. Marking the
      // observations distilled stops the sweep reconsidering them every night.
      if (!node) {
        await this.observations.markDistilled(group.map((observation) => observation.id));
        continue;
      }

      const lessonKind = LESSON_KIND_BY_OBSERVATION[kind];
      const distilled = await this.distiller.distil({
        flowId: input.flowId,
        nodeId,
        nodeName: node.name,
        nodeInstruction: typeof node.config.aiInstruction === "string" ? node.config.aiInstruction : "",
        kind: lessonKind,
        observations: group,
        existingStatements: existingResult.data
          .filter((lesson) => lesson.nodeId === nodeId && lesson.status === "accepted")
          .map((lesson) => lesson.statement),
      });
      if (distilled.error) return err(distilled.error);

      for (const candidate of distilled.data.candidates) {
        if (candidate.nodeId !== nodeId) {
          outcome.rejected.push({
            statement: candidate.statement,
            reason: "names a different node",
          });
          continue;
        }
        if (candidate.kind !== lessonKind) {
          outcome.rejected.push({ statement: candidate.statement, reason: "unexpected kind" });
          continue;
        }

        const created = await this.lessons.createProposed(
          candidate,
          input.flowId,
          group.map((observation) => observation.id),
        );
        if (created.error) return err(created.error);
        outcome.proposed += 1;
      }

      const marked = await this.observations.markDistilled(
        group.map((observation) => observation.id),
      );
      if (marked.error) return err(marked.error);
    }

    const retiredResult = await this.retireOrphans(input.flowId, [...nodesById.keys()]);
    if (retiredResult.error) return err(retiredResult.error);
    outcome.retired = retiredResult.data;

    return ok(outcome);
  }

  private groupsAboveThreshold(
    observations: FlowObservation[],
    threshold: number,
  ): Map<string, FlowObservation[]> {
    const grouped = new Map<string, FlowObservation[]>();
    for (const observation of observations) {
      const key = groupKey(observation);
      grouped.set(key, [...(grouped.get(key) ?? []), observation]);
    }

    // One bad session is noise. Below the threshold a group stays latent rather
    // than becoming doctrine (ADR-057 §4).
    for (const [key, group] of grouped) {
      if (group.length < threshold) grouped.delete(key);
    }
    return grouped;
  }

  private async retireOrphans(flowId: string, liveNodeIds: string[]): Promise<Result<number>> {
    const currentResult = await this.lessons.listByFlow(flowId);
    if (currentResult.error) return err(currentResult.error);

    const retiring = lessonsToRetire(currentResult.data, liveNodeIds);
    if (retiring.length === 0) return ok(0);

    const retired = await this.lessons.retireForMissingNodes(flowId, liveNodeIds);
    if (retired.error) return err(retired.error);

    for (const lesson of retired.data) {
      await this.auditLogger.log({
        action: "flow_lesson.retired",
        resourceType: "flow_lesson",
        resourceId: lesson.id,
        metadata: {
          flowId: lesson.flowId,
          nodeId: lesson.nodeId,
          reason: "node_removed",
        },
      });
    }

    return ok(retired.data.length);
  }
}
