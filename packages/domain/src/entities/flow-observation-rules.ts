// The seven capture rules (ADR-057 §1). Each is a pure predicate over data the
// session already wrote — no I/O, no model — and returns the observations to
// persist. Input projections are deliberately narrow: a caller holding full rows
// or a repository projection should not have to match an entity exactly to ask
// these questions.

import type { DocumentEdit } from "./session-message";
import { isSessionDiscarded, type SessionStatus } from "./session";
import type {
  FieldCorrectionOccurrence,
  NewFlowObservation,
  ObservationDetail,
  RedundantQuestionOccurrence,
} from "./flow-observation";

// A node is slow when it takes this many times its own flow-wide median.
export const EXCESS_TURNS_MULTIPLIER = 2;

// Below this many completed sessions a per-node median carries no information,
// so the kind does not fire at all. A new flow is therefore quiet for its first
// weeks, which is correct rather than a defect.
export const MIN_SESSIONS_FOR_TURN_MEDIAN = 5;

export interface ObservationContext {
  readonly flowId: string;
  readonly sessionId: string;
  // Every observation from one capture run shares the session's end time, so a
  // distillation group is ordered by when the evidence was produced rather than
  // by when the sweep happened to run.
  readonly occurredAt: Date;
}

const observation = (
  context: ObservationContext,
  nodeId: string,
  detail: ObservationDetail,
): NewFlowObservation => ({
  flowId: context.flowId,
  nodeId,
  sessionId: context.sessionId,
  kind: detail.kind,
  detail,
  occurredAt: context.occurredAt,
});

// Groups values by node while preserving first-seen node order, so one session
// yields at most one observation per node per kind — which is what the
// (session_id, node_id, kind) unique index allows.
const groupByNode = <TValue>(entries: { nodeId: string; value: TValue }[]): Map<string, TValue[]> => {
  const grouped = new Map<string, TValue[]>();
  for (const entry of entries) {
    const existing = grouped.get(entry.nodeId);
    if (existing) {
      existing.push(entry.value);
      continue;
    }
    grouped.set(entry.nodeId, [entry.value]);
  }
  return grouped;
};

export interface CapturedDocument {
  readonly stepNodeId: string | null;
  readonly editHistory: DocumentEdit[];
}

export const observeFieldCorrections = (input: {
  context: ObservationContext;
  documents: CapturedDocument[];
}): NewFlowObservation[] => {
  const corrections = input.documents.flatMap((document) => {
    if (!document.stepNodeId) return [];
    return document.editHistory.flatMap((edit) =>
      edit.changes.map((change) => ({
        nodeId: document.stepNodeId as string,
        value: {
          key: change.key,
          previousValue: change.previousValue,
          newValue: change.newValue,
        } satisfies FieldCorrectionOccurrence,
      })),
    );
  });

  return [...groupByNode(corrections)].map(([nodeId, values]) =>
    observation(input.context, nodeId, { kind: "field_corrected", corrections: values }),
  );
};

export interface CapturedAdvance {
  readonly nodeId: string;
  readonly confidence: number | null;
  readonly threshold: number;
}

export const observeLowConfidenceCompletions = (input: {
  context: ObservationContext;
  advances: CapturedAdvance[];
}): NewFlowObservation[] => {
  const below = input.advances.filter(
    (advance) => advance.confidence !== null && advance.confidence < advance.threshold,
  );

  const lowestByNode = new Map<string, CapturedAdvance>();
  for (const advance of below) {
    const current = lowestByNode.get(advance.nodeId);
    // The weakest advance is the one worth learning from, so a node that
    // advanced twice keeps its lowest rather than its latest.
    if (current && (current.confidence as number) <= (advance.confidence as number)) continue;
    lowestByNode.set(advance.nodeId, advance);
  }

  return [...lowestByNode].map(([nodeId, advance]) =>
    observation(input.context, nodeId, {
      kind: "low_confidence_completion",
      confidence: advance.confidence as number,
      threshold: advance.threshold,
    }),
  );
};

export const observeExcessTurns = (input: {
  context: ObservationContext;
  turnsByNode: Record<string, number>;
  medianTurnsByNode: Record<string, number>;
  completedSessionCount: number;
}): NewFlowObservation[] => {
  if (input.completedSessionCount < MIN_SESSIONS_FOR_TURN_MEDIAN) return [];

  return Object.entries(input.turnsByNode).flatMap(([nodeId, turns]) => {
    const median = input.medianTurnsByNode[nodeId];
    if (!median || median <= 0) return [];
    if (turns <= median * EXCESS_TURNS_MULTIPLIER) return [];

    return [
      observation(input.context, nodeId, { kind: "excess_turns", turns, medianTurns: median }),
    ];
  });
};

export interface CapturedQuestion {
  readonly nodeId: string;
  // The subject the question asked for, already extracted by the caller. Null
  // when it could not be extracted — which is not evidence of anything.
  readonly subjectKey: string | null;
  readonly question: string;
}

// Normalisation is the whole matching rule: lowercase, trim, and treat spaces and
// hyphens as underscores. There is deliberately no fuzzy fallback — a false
// positive here becomes a lesson telling the model not to ask for something it
// needs.
const normaliseContextKey = (key: string): string =>
  key.trim().toLowerCase().replace(/[\s-]+/g, "_");

export const observeRedundantQuestions = (input: {
  context: ObservationContext;
  questions: CapturedQuestion[];
  gatheredContextKeys: string[];
}): NewFlowObservation[] => {
  const gathered = new Set(input.gatheredContextKeys.map(normaliseContextKey));

  const redundant = input.questions.flatMap((question) => {
    if (!question.subjectKey) return [];
    const normalised = normaliseContextKey(question.subjectKey);
    if (!gathered.has(normalised)) return [];

    return [
      {
        nodeId: question.nodeId,
        value: {
          contextKey: normalised,
          question: question.question,
        } satisfies RedundantQuestionOccurrence,
      },
    ];
  });

  return [...groupByNode(redundant)].map(([nodeId, values]) =>
    observation(input.context, nodeId, { kind: "redundant_question", questions: values }),
  );
};

export interface CapturedChangeRequest {
  readonly nodeId: string;
  readonly comment: string;
}

export const observeChangeRequests = (input: {
  context: ObservationContext;
  changeRequests: CapturedChangeRequest[];
}): NewFlowObservation[] => {
  const commented = input.changeRequests
    .filter((request) => request.comment.trim().length > 0)
    .map((request) => ({ nodeId: request.nodeId, value: request.comment.trim() }));

  return [...groupByNode(commented)].map(([nodeId, comments]) =>
    observation(input.context, nodeId, { kind: "change_requested", comments }),
  );
};

export interface CapturedTurn {
  readonly nodeId: string;
  // Both are optional on `AiTurnPayload`, so a turn written before this release
  // reads as "not recorded" and must never be treated as a gap.
  readonly retrievedChunkCount: number | undefined;
  readonly missingInformation: string[] | undefined;
}

export const observeKnowledgeGaps = (input: {
  context: ObservationContext;
  turns: CapturedTurn[];
}): NewFlowObservation[] => {
  const gaps = input.turns.flatMap((turn) => {
    if (turn.retrievedChunkCount !== 0) return [];
    if (!turn.missingInformation || turn.missingInformation.length === 0) return [];

    return turn.missingInformation.map((item) => ({ nodeId: turn.nodeId, value: item }));
  });

  return [...groupByNode(gaps)].map(([nodeId, missingInformation]) =>
    observation(input.context, nodeId, { kind: "knowledge_gap", missingInformation }),
  );
};

export const observeAbandonment = (input: {
  context: ObservationContext;
  status: SessionStatus;
  currentNodeId: string | null;
}): NewFlowObservation[] => {
  if (!isSessionDiscarded(input.status)) return [];
  if (!input.currentNodeId) return [];

  return [
    observation(input.context, input.currentNodeId, {
      kind: "abandoned_at_step",
      status: input.status,
    }),
  ];
};
