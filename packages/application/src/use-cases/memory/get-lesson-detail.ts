import {
  canUserEditFlow,
  domainError,
  err,
  ok,
  type FlowLesson,
  type FlowObservation,
  type IFlowLessonRepository,
  type IFlowObservationRepository,
  type IFlowRepository,
  type Result,
} from "@wayfinder/domain";

export interface LessonEvidenceSession {
  sessionId: string | null;
  occurredAt: Date;
}

export interface LessonDetail {
  lesson: FlowLesson;
  observations: FlowObservation[];
  // The sessions behind the lesson, deduplicated. A null id is a session
  // retention has since removed — shown as such rather than hidden, so the
  // evidence count and the clickable list never silently disagree.
  evidenceSessions: LessonEvidenceSession[];
}

export interface GetLessonDetailInput {
  lessonId: string;
  userId: string;
  isAdmin?: boolean;
}

export class GetLessonDetail {
  constructor(
    private readonly lessons: IFlowLessonRepository,
    private readonly flows: IFlowRepository,
    private readonly observations: IFlowObservationRepository,
  ) {}

  async execute(input: GetLessonDetailInput): Promise<Result<LessonDetail>> {
    const lessonResult = await this.lessons.findById(input.lessonId);
    if (lessonResult.error) return err(lessonResult.error);
    if (!lessonResult.data) return err(domainError("NOT_FOUND", "Lesson not found."));

    const lesson = lessonResult.data;

    const flowResult = await this.flows.findById(lesson.flowId);
    if (flowResult.error) return err(flowResult.error);
    if (!flowResult.data) return err(domainError("NOT_FOUND", "Flow not found."));

    if (!canUserEditFlow(flowResult.data, input.userId, input.isAdmin ?? false)) {
      return err(domainError("FORBIDDEN", "You cannot view this flow's memory."));
    }

    const evidenceResult = await this.observations.listByLesson(lesson.id);
    if (evidenceResult.error) return err(evidenceResult.error);

    const seen = new Set<string>();
    const evidenceSessions: LessonEvidenceSession[] = [];
    for (const observation of evidenceResult.data) {
      const key = observation.sessionId ?? `deleted-${observation.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      evidenceSessions.push({
        sessionId: observation.sessionId,
        occurredAt: observation.occurredAt,
      });
    }

    return ok({ lesson, observations: evidenceResult.data, evidenceSessions });
  }
}
