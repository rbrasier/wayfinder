import type { FlowObservation } from "../entities/flow-observation";
import type { LessonCandidate, LessonKind } from "../entities/flow-lesson";
import type { Result } from "../result";

export interface LessonDistillationRequest {
  readonly nodeId: string;
  readonly nodeName: string;
  // What the author told the step to do, so a proposed rule sits beside the
  // instruction rather than contradicting it.
  readonly nodeInstruction: string;
  readonly kind: LessonKind;
  readonly observations: FlowObservation[];
  // Statements already accepted on this node, so the distiller can propose a
  // supersession rather than a near-duplicate of something already in force.
  readonly existingStatements: string[];
}

// Proposes and can do nothing else: the repository method that writes candidates
// takes no status argument (ADR-057 §3). Output is validated by the caller before
// persistence — a candidate naming another node, carrying an unknown kind, or
// restating a verbatim value from its own evidence is a reported reject.
export interface ILessonDistiller {
  distil(request: LessonDistillationRequest): Promise<Result<{ candidates: LessonCandidate[] }>>;
}
