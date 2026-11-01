import type { FlowLesson, LessonCandidate, LessonStatus } from "../entities/flow-lesson";
import type { Result } from "../result";

export interface IFlowLessonRepository {
  listByFlow(flowId: string): Promise<Result<FlowLesson[]>>;
  listAcceptedByFlow(flowId: string): Promise<Result<FlowLesson[]>>;
  findById(lessonId: string): Promise<Result<FlowLesson | null>>;
  // Takes no status argument, so there is no call site — present or future — at
  // which a distiller's output can be written as `accepted` (ADR-057 §3). The
  // lesson and its evidence rows are written as one unit of work; a lesson with
  // no evidence is a bug, not a lesson.
  createProposed(
    candidate: LessonCandidate,
    flowId: string,
    evidenceObservationIds: string[],
  ): Promise<Result<FlowLesson>>;
  setStatus(
    lessonId: string,
    status: LessonStatus,
    decidedByUserId: string | null,
  ): Promise<Result<FlowLesson>>;
  // Retires every lesson whose node is absent from the live flow, returning the
  // rows retired so the caller can audit each one (ADR-057 §7).
  retireForMissingNodes(flowId: string, liveNodeIds: string[]): Promise<Result<FlowLesson[]>>;
}
