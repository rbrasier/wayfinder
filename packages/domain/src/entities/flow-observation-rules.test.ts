import { describe, expect, it } from "vitest";
import {
  EXCESS_TURNS_MULTIPLIER,
  MIN_SESSIONS_FOR_TURN_MEDIAN,
  observeAbandonment,
  observeChangeRequests,
  observeExcessTurns,
  observeFieldCorrections,
  observeKnowledgeGaps,
  observeLowConfidenceCompletions,
  observeRedundantQuestions,
  type ObservationContext,
} from "./flow-observation-rules";

const context: ObservationContext = {
  flowId: "flow-1",
  sessionId: "session-1",
  occurredAt: new Date("2026-03-01T12:00:00Z"),
};

describe("observeFieldCorrections", () => {
  it("fires when a human changed a generated field after the step produced it", () => {
    const observations = observeFieldCorrections({
      context,
      documents: [
        {
          stepNodeId: "node-1",
          editHistory: [
            {
              editedAt: "2026-03-01T10:00:00Z",
              editedByUserId: "user-1",
              storagePath: "docs/one.docx",
              changes: [{ key: "supplier", previousValue: "Acme", newValue: "Acme Holdings Ltd" }],
            },
          ],
        },
      ],
    });

    expect(observations).toHaveLength(1);
    expect(observations[0]!.kind).toBe("field_corrected");
    expect(observations[0]!.nodeId).toBe("node-1");
    expect(observations[0]!.detail).toEqual({
      kind: "field_corrected",
      corrections: [{ key: "supplier", previousValue: "Acme", newValue: "Acme Holdings Ltd" }],
    });
  });

  it("collects every correction on one node into a single observation", () => {
    // The unique index is (session_id, node_id, kind), so four corrections on one
    // step must survive inside one row rather than three being dropped by the
    // conflict clause.
    const observations = observeFieldCorrections({
      context,
      documents: [
        {
          stepNodeId: "node-1",
          editHistory: [
            {
              editedAt: "2026-03-01T10:00:00Z",
              editedByUserId: "user-1",
              storagePath: "docs/one.docx",
              changes: [
                { key: "supplier", previousValue: "Acme", newValue: "Acme Ltd" },
                { key: "value", previousValue: "100", newValue: "1000" },
              ],
            },
            {
              editedAt: "2026-03-01T11:00:00Z",
              editedByUserId: "user-2",
              storagePath: "docs/one.docx",
              changes: [{ key: "term", previousValue: "12", newValue: "24" }],
            },
          ],
        },
      ],
    });

    expect(observations).toHaveLength(1);
    expect(observations[0]!.detail).toMatchObject({
      corrections: [
        { key: "supplier" },
        { key: "value" },
        { key: "term" },
      ],
    });
  });

  it("writes one observation per node when several steps were corrected", () => {
    const observations = observeFieldCorrections({
      context,
      documents: [
        {
          stepNodeId: "node-1",
          editHistory: [
            {
              editedAt: "2026-03-01T10:00:00Z",
              editedByUserId: "user-1",
              storagePath: "a.docx",
              changes: [{ key: "a", previousValue: "1", newValue: "2" }],
            },
          ],
        },
        {
          stepNodeId: "node-2",
          editHistory: [
            {
              editedAt: "2026-03-01T10:05:00Z",
              editedByUserId: "user-1",
              storagePath: "b.docx",
              changes: [{ key: "b", previousValue: "3", newValue: "4" }],
            },
          ],
        },
      ],
    });

    expect(observations.map((entry) => entry.nodeId)).toEqual(["node-1", "node-2"]);
  });

  it("does not fire for a document nobody edited", () => {
    expect(
      observeFieldCorrections({
        context,
        documents: [{ stepNodeId: "node-1", editHistory: [] }],
      }),
    ).toEqual([]);
  });

  it("does not fire for an edit that recorded no field changes", () => {
    expect(
      observeFieldCorrections({
        context,
        documents: [
          {
            stepNodeId: "node-1",
            editHistory: [
              {
                editedAt: "2026-03-01T10:00:00Z",
                editedByUserId: "user-1",
                storagePath: "a.docx",
                changes: [],
              },
            ],
          },
        ],
      }),
    ).toEqual([]);
  });

  it("ignores a document with no step to attribute it to", () => {
    expect(
      observeFieldCorrections({
        context,
        documents: [
          {
            stepNodeId: null,
            editHistory: [
              {
                editedAt: "2026-03-01T10:00:00Z",
                editedByUserId: "user-1",
                storagePath: "a.docx",
                changes: [{ key: "a", previousValue: "1", newValue: "2" }],
              },
            ],
          },
        ],
      }),
    ).toEqual([]);
  });
});

describe("observeLowConfidenceCompletions", () => {
  it("fires when a step advanced below its threshold", () => {
    const observations = observeLowConfidenceCompletions({
      context,
      advances: [{ nodeId: "node-1", confidence: 62, threshold: 90 }],
    });

    expect(observations).toHaveLength(1);
    expect(observations[0]!.kind).toBe("low_confidence_completion");
    expect(observations[0]!.detail).toEqual({
      kind: "low_confidence_completion",
      confidence: 62,
      threshold: 90,
    });
  });

  it("does not fire when the step met its threshold", () => {
    expect(
      observeLowConfidenceCompletions({
        context,
        advances: [{ nodeId: "node-1", confidence: 95, threshold: 90 }],
      }),
    ).toEqual([]);
  });

  it("does not fire when confidence exactly meets the threshold", () => {
    expect(
      observeLowConfidenceCompletions({
        context,
        advances: [{ nodeId: "node-1", confidence: 90, threshold: 90 }],
      }),
    ).toEqual([]);
  });

  it("keeps the lowest confidence when a node advanced more than once", () => {
    const observations = observeLowConfidenceCompletions({
      context,
      advances: [
        { nodeId: "node-1", confidence: 80, threshold: 90 },
        { nodeId: "node-1", confidence: 55, threshold: 90 },
      ],
    });

    expect(observations).toHaveLength(1);
    expect(observations[0]!.detail).toMatchObject({ confidence: 55 });
  });

  it("ignores an advance with no recorded confidence", () => {
    expect(
      observeLowConfidenceCompletions({
        context,
        advances: [{ nodeId: "node-1", confidence: null, threshold: 90 }],
      }),
    ).toEqual([]);
  });
});

describe("observeExcessTurns", () => {
  it("fires when a node's turns exceed the multiple of its flow median", () => {
    const observations = observeExcessTurns({
      context,
      turnsByNode: { "node-1": 9 },
      medianTurnsByNode: { "node-1": 3 },
      completedSessionCount: 20,
    });

    expect(observations).toHaveLength(1);
    expect(observations[0]!.kind).toBe("excess_turns");
    expect(observations[0]!.detail).toEqual({ kind: "excess_turns", turns: 9, medianTurns: 3 });
  });

  it("does not fire at exactly the multiple", () => {
    expect(
      observeExcessTurns({
        context,
        turnsByNode: { "node-1": 6 },
        medianTurnsByNode: { "node-1": 3 },
        completedSessionCount: 20,
      }),
    ).toEqual([]);
  });

  it("does not fire at all below the minimum session population", () => {
    // A median over four sessions means nothing; the flow is quiet at first, by
    // design.
    expect(
      observeExcessTurns({
        context,
        turnsByNode: { "node-1": 30 },
        medianTurnsByNode: { "node-1": 3 },
        completedSessionCount: MIN_SESSIONS_FOR_TURN_MEDIAN - 1,
      }),
    ).toEqual([]);
  });

  it("does not fire for a node with no median to compare against", () => {
    expect(
      observeExcessTurns({
        context,
        turnsByNode: { "node-1": 30 },
        medianTurnsByNode: {},
        completedSessionCount: 20,
      }),
    ).toEqual([]);
  });

  it("does not fire when the median is zero", () => {
    expect(
      observeExcessTurns({
        context,
        turnsByNode: { "node-1": 4 },
        medianTurnsByNode: { "node-1": 0 },
        completedSessionCount: 20,
      }),
    ).toEqual([]);
  });

  it("uses the documented multiplier", () => {
    const justOver = EXCESS_TURNS_MULTIPLIER * 3 + 1;

    expect(
      observeExcessTurns({
        context,
        turnsByNode: { "node-1": justOver },
        medianTurnsByNode: { "node-1": 3 },
        completedSessionCount: 20,
      }),
    ).toHaveLength(1);
  });
});

describe("observeRedundantQuestions", () => {
  it("fires when a question's subject is already a gathered context key", () => {
    const observations = observeRedundantQuestions({
      context,
      questions: [{ nodeId: "node-1", subjectKey: "supplier_name", question: "Who is the supplier?" }],
      gatheredContextKeys: ["supplier_name", "contract_value"],
    });

    expect(observations).toHaveLength(1);
    expect(observations[0]!.kind).toBe("redundant_question");
    expect(observations[0]!.detail).toEqual({
      kind: "redundant_question",
      questions: [{ contextKey: "supplier_name", question: "Who is the supplier?" }],
    });
  });

  it("matches on a normalised key rather than an exact string", () => {
    const observations = observeRedundantQuestions({
      context,
      questions: [{ nodeId: "node-1", subjectKey: " Supplier Name ", question: "Who?" }],
      gatheredContextKeys: ["supplier_name"],
    });

    expect(observations).toHaveLength(1);
  });

  it("does not fire when the subject was never gathered", () => {
    expect(
      observeRedundantQuestions({
        context,
        questions: [{ nodeId: "node-1", subjectKey: "delivery_date", question: "When?" }],
        gatheredContextKeys: ["supplier_name"],
      }),
    ).toEqual([]);
  });

  it("does not fire for a question with no extracted subject", () => {
    // No fuzzy fallback: a question whose subject could not be extracted is not
    // evidence. A false positive here becomes a lesson telling the model not to
    // ask for something it needs.
    expect(
      observeRedundantQuestions({
        context,
        questions: [{ nodeId: "node-1", subjectKey: null, question: "Anything else?" }],
        gatheredContextKeys: ["supplier_name"],
      }),
    ).toEqual([]);
  });

  it("collects every redundant question on one node into a single observation", () => {
    const observations = observeRedundantQuestions({
      context,
      questions: [
        { nodeId: "node-1", subjectKey: "supplier_name", question: "Who is the supplier?" },
        { nodeId: "node-1", subjectKey: "contract_value", question: "How much?" },
      ],
      gatheredContextKeys: ["supplier_name", "contract_value"],
    });

    expect(observations).toHaveLength(1);
    expect(observations[0]!.detail).toMatchObject({
      questions: [{ contextKey: "supplier_name" }, { contextKey: "contract_value" }],
    });
  });
});

describe("observeChangeRequests", () => {
  it("fires when an approval routed work back with a comment", () => {
    const observations = observeChangeRequests({
      context,
      changeRequests: [{ nodeId: "node-1", comment: "The scope section is missing the exclusions." }],
    });

    expect(observations).toHaveLength(1);
    expect(observations[0]!.kind).toBe("change_requested");
    expect(observations[0]!.detail).toEqual({
      kind: "change_requested",
      comments: ["The scope section is missing the exclusions."],
    });
  });

  it("does not fire for a change request with no comment", () => {
    expect(
      observeChangeRequests({ context, changeRequests: [{ nodeId: "node-1", comment: "   " }] }),
    ).toEqual([]);
  });

  it("collects every comment on one node into a single observation", () => {
    const observations = observeChangeRequests({
      context,
      changeRequests: [
        { nodeId: "node-1", comment: "First bounce." },
        { nodeId: "node-1", comment: "Second bounce." },
      ],
    });

    expect(observations).toHaveLength(1);
    expect(observations[0]!.detail).toMatchObject({ comments: ["First bounce.", "Second bounce."] });
  });
});

describe("observeKnowledgeGaps", () => {
  it("fires when retrieval returned nothing and the reply signalled missing information", () => {
    const observations = observeKnowledgeGaps({
      context,
      turns: [
        {
          nodeId: "node-1",
          retrievedChunkCount: 0,
          missingInformation: ["The current mileage rate is not in the knowledge base."],
        },
      ],
    });

    expect(observations).toHaveLength(1);
    expect(observations[0]!.kind).toBe("knowledge_gap");
    expect(observations[0]!.detail).toEqual({
      kind: "knowledge_gap",
      missingInformation: ["The current mileage rate is not in the knowledge base."],
    });
  });

  it("does not fire when retrieval found something, even with missing information", () => {
    expect(
      observeKnowledgeGaps({
        context,
        turns: [{ nodeId: "node-1", retrievedChunkCount: 3, missingInformation: ["Something."] }],
      }),
    ).toEqual([]);
  });

  it("does not fire when nothing was missing, even with no retrieval", () => {
    expect(
      observeKnowledgeGaps({
        context,
        turns: [{ nodeId: "node-1", retrievedChunkCount: 0, missingInformation: [] }],
      }),
    ).toEqual([]);
  });

  it("does not fire when the turn recorded neither field", () => {
    // Both fields are optional on AiTurnPayload, so a turn written before this
    // release reads as "not recorded" and must not be treated as a gap.
    expect(
      observeKnowledgeGaps({
        context,
        turns: [
          { nodeId: "node-1", retrievedChunkCount: undefined, missingInformation: undefined },
        ],
      }),
    ).toEqual([]);
  });

  it("collects the missing information from every gap turn on one node", () => {
    const observations = observeKnowledgeGaps({
      context,
      turns: [
        { nodeId: "node-1", retrievedChunkCount: 0, missingInformation: ["First."] },
        { nodeId: "node-1", retrievedChunkCount: 0, missingInformation: ["Second."] },
      ],
    });

    expect(observations).toHaveLength(1);
    expect(observations[0]!.detail).toMatchObject({ missingInformation: ["First.", "Second."] });
  });
});

describe("observeAbandonment", () => {
  it("fires when the session was abandoned on a step", () => {
    const observations = observeAbandonment({
      context,
      status: "abandoned",
      currentNodeId: "node-1",
    });

    expect(observations).toHaveLength(1);
    expect(observations[0]!.kind).toBe("abandoned_at_step");
    expect(observations[0]!.detail).toEqual({ kind: "abandoned_at_step", status: "abandoned" });
  });

  it("fires for a cancelled session, which counts as discarded", () => {
    const observations = observeAbandonment({
      context,
      status: "cancelled",
      currentNodeId: "node-1",
    });

    expect(observations[0]!.detail).toMatchObject({ status: "cancelled" });
  });

  it("does not fire for a completed session", () => {
    expect(
      observeAbandonment({ context, status: "complete", currentNodeId: "node-1" }),
    ).toEqual([]);
  });

  it("does not fire when there is no step to attribute the abandonment to", () => {
    expect(
      observeAbandonment({ context, status: "abandoned", currentNodeId: null }),
    ).toEqual([]);
  });
});

describe("every rule", () => {
  it("stamps the flow, session and occurredAt from the shared context", () => {
    const observations = observeAbandonment({
      context,
      status: "abandoned",
      currentNodeId: "node-1",
    });

    expect(observations[0]!).toMatchObject({
      flowId: "flow-1",
      sessionId: "session-1",
      occurredAt: context.occurredAt,
    });
  });
});
