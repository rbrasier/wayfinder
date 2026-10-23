import { describe, expect, it } from "vitest";
import { buildRunStartedMessage, parseRunStartedMessage, runStartedInsights } from "./run-started-message";

describe("buildRunStartedMessage", () => {
  it("names the Event Watch that started the run", () => {
    expect(buildRunStartedMessage({ origin: "watch", sourceName: "ParlView hearings" })).toBe(
      'Started by Event Watch "ParlView hearings".',
    );
  });

  it("says a webhook started the run", () => {
    expect(buildRunStartedMessage({ origin: "webhook", sourceName: null })).toBe("Started by a webhook.");
  });
});

describe("parseRunStartedMessage", () => {
  it("reads back what the builder wrote", () => {
    expect(parseRunStartedMessage('Started by Event Watch "ParlView hearings".')).toEqual({
      origin: "watch",
      sourceName: "ParlView hearings",
    });
    expect(parseRunStartedMessage("Started by a webhook.")).toEqual({ origin: "webhook", sourceName: null });
  });

  it("ignores any other text", () => {
    expect(parseRunStartedMessage("Started by a person.")).toBeNull();
  });
});

describe("runStartedInsights", () => {
  it("records each declared input under its label, in declared order", () => {
    const insights = runStartedInsights(
      [
        { key: "hearing_id", label: "Hearing", type: "text", required: true },
        { key: "sitting_day", label: "Sitting day", type: "number", required: false },
        { key: "details", label: "Details", type: "json", required: false },
      ],
      { details: { room: "2S1" }, hearing_id: "pv-12", sitting_day: 4 },
    );

    expect(insights).toEqual([
      { key: "Hearing", value: "pv-12" },
      { key: "Sitting day", value: "4" },
      { key: "Details", value: '{"room":"2S1"}' },
    ]);
  });

  it("skips an input the run was not given, and falls back to the key for an unlabelled one", () => {
    const insights = runStartedInsights(
      [
        { key: "hearing_id", label: "", type: "text", required: true },
        { key: "topic", label: "Topic", type: "text", required: false },
      ],
      { hearing_id: "pv-12" },
    );

    expect(insights).toEqual([{ key: "hearing_id", value: "pv-12" }]);
  });
});
