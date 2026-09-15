// Where an accepted lesson goes (ADR-057 §5, §6). `guidance` and `efficiency`
// render into the step's system prompt; `knowledge_gap` never does — it raises an
// item in the ADR-028 curation loop instead.
export type LessonKind = "guidance" | "efficiency" | "knowledge_gap";

// Only `accepted` has any runtime effect. `retired` is the one machine-driven
// transition: a lesson whose node no longer exists in the flow.
export type LessonStatus = "proposed" | "accepted" | "rejected" | "retired";

// A prompt-safety bound rather than an operator preference, so it is a domain
// constant and not an `admin_system_settings` key. Without it, a flow running for
// two years reaches the model as a wall of accumulated advice competing with its
// own instructions.
export const INJECTED_LESSON_CAP = 5;

export interface FlowLesson {
  readonly id: string;
  readonly flowId: string;
  readonly nodeId: string;
  readonly kind: LessonKind;
  readonly statement: string;
  readonly status: LessonStatus;
  readonly evidenceCount: number;
  readonly firstSeenAt: Date;
  readonly lastSeenAt: Date;
  readonly acceptedByUserId: string | null;
  readonly acceptedAt: Date | null;
  readonly supersedesLessonId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// What the distiller returns. It carries no status: a candidate becomes a lesson
// only through `createProposed`, which takes no status argument, so there is no
// call site at which a model's output can be written as `accepted` (ADR-057 §3).
export interface LessonCandidate {
  readonly nodeId: string;
  readonly kind: LessonKind;
  readonly statement: string;
  readonly supersedesLessonId?: string | null;
}

// The prompt-facing projection, mirroring `ResolvedSkill`. Nothing but the
// statement reaches the model.
export interface ResolvedLesson {
  readonly statement: string;
}

const INJECTABLE_KINDS: readonly LessonKind[] = ["guidance", "efficiency"];

export const isInjectable = (lesson: FlowLesson): boolean =>
  lesson.status === "accepted" &&
  INJECTABLE_KINDS.includes(lesson.kind) &&
  lesson.statement.trim().length > 0;

// Most recently accepted first, then capped. A lesson with no `acceptedAt` sorts
// last rather than being dropped — the ordering is a preference, the cap is the
// safety bound.
export const selectInjectableLessons = (
  lessons: FlowLesson[],
  cap: number = INJECTED_LESSON_CAP,
): ResolvedLesson[] =>
  lessons
    .filter(isInjectable)
    .sort((left, right) => (right.acceptedAt?.getTime() ?? 0) - (left.acceptedAt?.getTime() ?? 0))
    .slice(0, cap)
    .map((lesson) => ({ statement: lesson.statement }));

// A lesson whose node the author has deleted has nothing to attach to (ADR-058
// §2). An empty `liveNodeIds` means the caller could not resolve the graph, not
// that the flow has no steps — retiring on that basis would withdraw every lesson
// on the flow at once.
export const lessonsToRetire = (lessons: FlowLesson[], liveNodeIds: string[]): FlowLesson[] => {
  if (liveNodeIds.length === 0) return [];

  const live = new Set(liveNodeIds);
  return lessons.filter((lesson) => lesson.status !== "retired" && !live.has(lesson.nodeId));
};
