// One captured, typed fact about a single step of a single flow in a single
// session (ADR-057). Derived mechanically from data the session already wrote —
// no model is in its path — and never shown to an author as advice. The claim
// built from a group of these is a `FlowLesson`.
export type ObservationKind =
  | "field_corrected"
  | "low_confidence_completion"
  | "excess_turns"
  | "redundant_question"
  | "change_requested"
  | "knowledge_gap"
  | "abandoned_at_step";

export const OBSERVATION_KINDS: readonly ObservationKind[] = [
  "field_corrected",
  "low_confidence_completion",
  "excess_turns",
  "redundant_question",
  "change_requested",
  "knowledge_gap",
  "abandoned_at_step",
];

// One generated field a human overwrote after the step produced it.
export interface FieldCorrectionOccurrence {
  readonly key: string;
  readonly previousValue: string;
  readonly newValue: string;
}

// One assistant question whose subject was already present in gathered context.
export interface RedundantQuestionOccurrence {
  readonly contextKey: string;
  readonly question: string;
}

// The per-kind payload, discriminated on `kind`. Several kinds carry a list
// rather than a single occurrence: the unique index is
// `(session_id, node_id, kind)`, so one session contributes one row per kind per
// node, and a session that corrected four fields on one step must record all
// four inside that row rather than losing three to the conflict clause.
export type ObservationDetail =
  | { readonly kind: "field_corrected"; readonly corrections: FieldCorrectionOccurrence[] }
  | {
      readonly kind: "low_confidence_completion";
      readonly confidence: number;
      readonly threshold: number;
    }
  | { readonly kind: "excess_turns"; readonly turns: number; readonly medianTurns: number }
  | { readonly kind: "redundant_question"; readonly questions: RedundantQuestionOccurrence[] }
  | { readonly kind: "change_requested"; readonly comments: string[] }
  | { readonly kind: "knowledge_gap"; readonly missingInformation: string[] }
  | { readonly kind: "abandoned_at_step"; readonly status: string };

export interface FlowObservation {
  readonly id: string;
  readonly flowId: string;
  readonly nodeId: string;
  // Null once retention removes the session behind it. The observation survives,
  // because the lesson it supports may still be in force (ADR-057).
  readonly sessionId: string | null;
  readonly kind: ObservationKind;
  readonly detail: ObservationDetail;
  readonly occurredAt: Date;
  readonly distilledAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewFlowObservation {
  readonly flowId: string;
  readonly nodeId: string;
  readonly sessionId: string;
  readonly kind: ObservationKind;
  readonly detail: ObservationDetail;
  readonly occurredAt: Date;
}
