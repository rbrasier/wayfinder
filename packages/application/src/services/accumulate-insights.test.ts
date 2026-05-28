import { describe, expect, it } from "vitest";
import type { AiTurnPayload, SessionMessage } from "@rbrasier/domain";
import { accumulateInsights } from "./accumulate-insights";

const makeAssistant = (
  id: string,
  contextGathered: { key: string; value: string }[],
  createdAt: Date,
): SessionMessage => ({
  id,
  sessionId: "sess-1",
  role: "assistant",
  content: "",
  confidence: 80,
  stepNodeId: "node-1",
  document: null,
  documentStatus: null,
  aiPayload: {
    response: "",
    rationale: "",
    stepCompleteConfidence: 80,
    contextGathered,
  } satisfies AiTurnPayload,
  createdAt,
});

const makeUser = (id: string, createdAt: Date): SessionMessage => ({
  id,
  sessionId: "sess-1",
  role: "user",
  content: "hello",
  confidence: null,
  stepNodeId: null,
  document: null,
  documentStatus: null,
  aiPayload: null,
  createdAt,
});

describe("accumulateInsights", () => {
  it("returns an empty array when no messages have an aiPayload", () => {
    const messages = [
      makeUser("u1", new Date("2026-01-01T10:00:00Z")),
      makeUser("u2", new Date("2026-01-01T10:01:00Z")),
    ];

    expect(accumulateInsights(messages)).toEqual([]);
  });

  it("collects contextGathered entries from a single assistant message", () => {
    const messages = [
      makeAssistant(
        "a1",
        [
          { key: "Project name", value: "Cloud migration" },
          { key: "Budget", value: "$500k" },
        ],
        new Date("2026-01-01T10:00:00Z"),
      ),
    ];

    expect(accumulateInsights(messages)).toEqual([
      { key: "Project name", value: "Cloud migration" },
      { key: "Budget", value: "$500k" },
    ]);
  });

  it("deduplicates by key keeping the most recent value", () => {
    const messages = [
      makeAssistant(
        "a1",
        [{ key: "Budget", value: "$500k" }],
        new Date("2026-01-01T10:00:00Z"),
      ),
      makeAssistant(
        "a2",
        [{ key: "Budget", value: "$750k" }],
        new Date("2026-01-01T10:05:00Z"),
      ),
    ];

    expect(accumulateInsights(messages)).toEqual([{ key: "Budget", value: "$750k" }]);
  });

  it("preserves the first-seen order of distinct keys", () => {
    const messages = [
      makeAssistant(
        "a1",
        [
          { key: "Project name", value: "Cloud migration" },
          { key: "Budget", value: "$500k" },
        ],
        new Date("2026-01-01T10:00:00Z"),
      ),
      makeAssistant(
        "a2",
        [
          { key: "Deadline", value: "Q3 2026" },
          { key: "Project name", value: "Cloud migration phase 1" },
        ],
        new Date("2026-01-01T10:05:00Z"),
      ),
    ];

    expect(accumulateInsights(messages)).toEqual([
      { key: "Project name", value: "Cloud migration phase 1" },
      { key: "Budget", value: "$500k" },
      { key: "Deadline", value: "Q3 2026" },
    ]);
  });

  it("ignores user messages and assistant messages with null aiPayload", () => {
    const messages = [
      makeUser("u1", new Date("2026-01-01T10:00:00Z")),
      {
        ...makeAssistant("a1", [], new Date("2026-01-01T10:01:00Z")),
        aiPayload: null,
      },
      makeAssistant(
        "a2",
        [{ key: "Budget", value: "$500k" }],
        new Date("2026-01-01T10:02:00Z"),
      ),
    ];

    expect(accumulateInsights(messages)).toEqual([{ key: "Budget", value: "$500k" }]);
  });
});
