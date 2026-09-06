import {
  canUserEditFlow,
  domainError,
  err,
  ok,
  type FlowLesson,
  type IAnswerFeedbackRepository,
  type IAuditLogger,
  type IFlowLessonRepository,
  type IFlowObservationRepository,
  type IFlowRepository,
  type Result,
} from "@rbrasier/domain";

export interface AcceptLessonInput {
  lessonId: string;
  userId: string;
  isAdmin?: boolean;
}

// Accepting is the only thing that gives a lesson any effect on a live flow, so
// it is guarded here rather than only in the router, and audited with the
// statement verbatim — the audit log answers "what exactly was the model told to
// do" without a join to a row that may since have been superseded.
export class AcceptLesson {
  constructor(
    private readonly lessons: IFlowLessonRepository,
    private readonly flows: IFlowRepository,
    private readonly observations: IFlowObservationRepository,
    private readonly answerFeedback: IAnswerFeedbackRepository,
    private readonly auditLogger: IAuditLogger,
  ) {}

  async execute(input: AcceptLessonInput): Promise<Result<FlowLesson>> {
    const lessonResult = await this.lessons.findById(input.lessonId);
    if (lessonResult.error) return err(lessonResult.error);
    if (!lessonResult.data) return err(domainError("NOT_FOUND", "Lesson not found."));

    const lesson = lessonResult.data;

    const flowResult = await this.flows.findById(lesson.flowId);
    if (flowResult.error) return err(flowResult.error);
    if (!flowResult.data) return err(domainError("NOT_FOUND", "Flow not found."));

    if (!canUserEditFlow(flowResult.data, input.userId, input.isAdmin ?? false)) {
      return err(domainError("FORBIDDEN", "You cannot change this flow's memory."));
    }

    const accepted = await this.lessons.setStatus(lesson.id, "accepted", input.userId);
    if (accepted.error) return err(accepted.error);

    // A knowledge gap is not fixed by telling the model to be more careful, so
    // accepting one raises curation work and produces no prompt text at all
    // (ADR-057 §6). `isInjectable` already excludes the kind; this is the other
    // half of the decision, not a duplicate of it.
    if (lesson.kind === "knowledge_gap") {
      const feedbackResult = await this.raiseCurationItem(lesson, input.userId);
      if (feedbackResult.error) return err(feedbackResult.error);
    }

    await this.auditLogger.log({
      actorId: input.userId,
      action: "flow_lesson.accepted",
      resourceType: "flow_lesson",
      resourceId: lesson.id,
      metadata: {
        flowId: lesson.flowId,
        nodeId: lesson.nodeId,
        kind: lesson.kind,
        statement: lesson.statement,
      },
    });

    return ok(accepted.data);
  }

  private async raiseCurationItem(lesson: FlowLesson, userId: string): Promise<Result<unknown>> {
    const evidenceResult = await this.observations.listByLesson(lesson.id);
    if (evidenceResult.error) return err(evidenceResult.error);

    // The most recent evidence session that still exists. Null when retention has
    // removed them all, which the nullable column exists to allow.
    const sessionId =
      [...evidenceResult.data]
        .reverse()
        .find((observation) => observation.sessionId !== null)?.sessionId ?? null;

    return this.answerFeedback.create({
      sessionId,
      messageId: null,
      source: "flow_lesson",
      flaggedAnswer: lesson.statement,
      // Empty on purpose: nobody knows the answer yet. Supplying it is the
      // curation work this row exists to raise.
      correctedText: "",
      reason: "incomplete",
      createdBy: userId,
    });
  }
}
