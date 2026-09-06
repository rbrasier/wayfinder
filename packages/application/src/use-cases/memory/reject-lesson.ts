import {
  canUserEditFlow,
  domainError,
  err,
  ok,
  type FlowLesson,
  type IAuditLogger,
  type IFlowLessonRepository,
  type IFlowRepository,
  type Result,
} from "@rbrasier/domain";

export interface RejectLessonInput {
  lessonId: string;
  userId: string;
  isAdmin?: boolean;
}

// A rejected lesson is inert and stays that way — there is no path back to
// proposed, so an owner who has judged a lesson wrong does not see it again.
export class RejectLesson {
  constructor(
    private readonly lessons: IFlowLessonRepository,
    private readonly flows: IFlowRepository,
    private readonly auditLogger: IAuditLogger,
  ) {}

  async execute(input: RejectLessonInput): Promise<Result<FlowLesson>> {
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

    const rejected = await this.lessons.setStatus(lesson.id, "rejected", input.userId);
    if (rejected.error) return err(rejected.error);

    await this.auditLogger.log({
      actorId: input.userId,
      action: "flow_lesson.rejected",
      resourceType: "flow_lesson",
      resourceId: lesson.id,
      metadata: { flowId: lesson.flowId, nodeId: lesson.nodeId, kind: lesson.kind },
    });

    return ok(rejected.data);
  }
}
