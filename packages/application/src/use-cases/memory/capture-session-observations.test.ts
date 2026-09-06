import { describe, expect, it, vi } from "vitest";
import { ok, type NewFlowObservation, type Session, type SessionMessage } from "@rbrasier/domain";
import { CaptureSessionObservations } from "./capture-session-observations";
import {
  makeCaptureDoubles,
  message,
  session,
  type CaptureDoubles,
} from "./__fixtures__/capture-doubles";

const run = async (doubles: CaptureDoubles, sessionId = "session-1") =>
  new CaptureSessionObservations(
    doubles.sessions,
    doubles.messages,
    doubles.approvals,
    doubles.analytics,
    doubles.observations,
  ).execute(sessionId);

const written = (doubles: CaptureDoubles): NewFlowObservation[] =>
  vi.mocked(doubles.observations.createMany).mock.calls.flatMap((call) => call[0]);

describe("CaptureSessionObservations", () => {
  it("writes nothing for a test-mode session, before loading anything", async () => {
    // An author probing a step's failure modes would otherwise manufacture the
    // evidence for a lesson about the failure they were provoking (ADR-057 §2).
    const doubles = makeCaptureDoubles({
      session: session({ mode: "test", status: "abandoned", currentNodeId: "node-1" }),
    });

    const result = await run(doubles);

    expect(result.error).toBeUndefined();
    expect(doubles.observations.createMany).not.toHaveBeenCalled();
    expect(doubles.messages.listBySession).not.toHaveBeenCalled();
  });

  it("writes nothing for a session that has not reached a terminal state", async () => {
    const doubles = makeCaptureDoubles({
      session: session({ status: "active", currentNodeId: "node-1" }),
    });

    await run(doubles);

    expect(doubles.observations.createMany).not.toHaveBeenCalled();
  });

  it("captures an abandonment on the step the session died on", async () => {
    const doubles = makeCaptureDoubles({
      session: session({ status: "abandoned", currentNodeId: "node-1" }),
    });

    await run(doubles);

    expect(written(doubles)).toContainEqual(
      expect.objectContaining({ kind: "abandoned_at_step", nodeId: "node-1" }),
    );
  });

  it("captures a low-confidence completion from the advancing turn", async () => {
    const doubles = makeCaptureDoubles({
      session: session({ status: "complete" }),
      messages: [
        message({
          stepNodeId: "node-1",
          confidence: 62,
          aiPayload: { stepCompleteConfidence: 62, contextGathered: [] },
        }),
      ],
      advanceThreshold: 90,
    });

    await run(doubles);

    expect(written(doubles)).toContainEqual(
      expect.objectContaining({ kind: "low_confidence_completion", nodeId: "node-1" }),
    );
  });

  it("captures a knowledge gap from the two persisted turn fields", async () => {
    const doubles = makeCaptureDoubles({
      session: session({ status: "complete" }),
      messages: [
        message({
          stepNodeId: "node-1",
          aiPayload: {
            stepCompleteConfidence: 95,
            contextGathered: [],
            retrievedChunkCount: 0,
            missingInformation: ["The current mileage rate is not in the knowledge base."],
          },
        }),
      ],
    });

    await run(doubles);

    expect(written(doubles)).toContainEqual(
      expect.objectContaining({ kind: "knowledge_gap", nodeId: "node-1" }),
    );
  });

  it("does not invent a knowledge gap from a turn that recorded neither field", async () => {
    const doubles = makeCaptureDoubles({
      session: session({ status: "complete" }),
      messages: [
        message({ stepNodeId: "node-1", aiPayload: { stepCompleteConfidence: 95, contextGathered: [] } }),
      ],
    });

    await run(doubles);

    expect(written(doubles).map((entry) => entry.kind)).not.toContain("knowledge_gap");
  });

  it("captures a redundant question when a later turn re-recorded a known key", async () => {
    const doubles = makeCaptureDoubles({
      session: session({ status: "complete" }),
      messages: [
        message({
          id: "m1",
          stepNodeId: "node-1",
          aiPayload: {
            stepCompleteConfidence: 95,
            contextGathered: [{ key: "supplier_name", value: "Acme" }],
          },
        }),
        message({
          id: "m2",
          stepNodeId: "node-2",
          content: "Who is the supplier?",
          aiPayload: {
            stepCompleteConfidence: 95,
            contextGathered: [{ key: "supplier_name", value: "Acme" }],
          },
        }),
      ],
      gatheredContextKeys: ["supplier_name"],
    });

    await run(doubles);

    expect(written(doubles)).toContainEqual(
      expect.objectContaining({ kind: "redundant_question", nodeId: "node-2" }),
    );
  });

  it("does not call the first recording of a key a redundant question", async () => {
    const doubles = makeCaptureDoubles({
      session: session({ status: "complete" }),
      messages: [
        message({
          stepNodeId: "node-1",
          aiPayload: {
            stepCompleteConfidence: 95,
            contextGathered: [{ key: "supplier_name", value: "Acme" }],
          },
        }),
      ],
      gatheredContextKeys: ["supplier_name"],
    });

    await run(doubles);

    expect(written(doubles).map((entry) => entry.kind)).not.toContain("redundant_question");
  });

  it("captures a change request with the approver's comment", async () => {
    const doubles = makeCaptureDoubles({
      session: session({ status: "complete" }),
      approvals: [
        {
          nodeId: "node-2",
          status: "changes_requested",
          comment: "The scope section is missing the exclusions.",
          decidedAt: new Date("2026-03-01T09:00:00Z"),
        },
      ],
    });

    await run(doubles);

    expect(written(doubles)).toContainEqual(
      expect.objectContaining({ kind: "change_requested", nodeId: "node-2" }),
    );
  });

  it("stamps every observation with the flow and session it came from", async () => {
    const doubles = makeCaptureDoubles({
      session: session({ status: "abandoned", currentNodeId: "node-1" }),
    });

    await run(doubles);

    for (const observation of written(doubles)) {
      expect(observation.flowId).toBe("flow-1");
      expect(observation.sessionId).toBe("session-1");
    }
  });

  it("returns the number of observations the repository actually wrote", async () => {
    const doubles = makeCaptureDoubles({
      session: session({ status: "abandoned", currentNodeId: "node-1" }),
    });
    vi.mocked(doubles.observations.createMany).mockResolvedValue(ok(1));

    const result = await run(doubles);

    expect(result.data).toEqual({ written: 1 });
  });

  it("reports a missing session as NOT_FOUND rather than throwing", async () => {
    const doubles = makeCaptureDoubles({ session: null });

    const result = await run(doubles);

    expect(result.error?.code).toBe("NOT_FOUND");
  });

  it("suppresses excess-turn capture below the minimum session population", async () => {
    const manyTurns: SessionMessage[] = Array.from({ length: 12 }, (_unused, index) =>
      message({ id: `m${index}`, stepNodeId: "node-1" }),
    );
    const doubles = makeCaptureDoubles({
      session: session({ status: "complete" }),
      messages: manyTurns,
      completedSessionCount: 2,
    });

    await run(doubles);

    expect(written(doubles).map((entry) => entry.kind)).not.toContain("excess_turns");
  });
});
