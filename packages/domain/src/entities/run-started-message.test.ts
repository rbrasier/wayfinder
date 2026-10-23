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
  const declared = [
    { key: "hearing_id", label: "Hearing", type: "text" as const, required: true },
    { key: "sitting_day", label: "Sitting day", type: "number" as const, required: false },
    { key: "topic", label: "", type: "text" as const, required: false },
  ];

  it("records the declared inputs, then every field of the item, tagged with where they came from", () => {
    const insights = runStartedInsights({
      origin: "watch",
      declared,
      inputs: { hearing_id: "pv-12", sitting_day: 4 },
      raw: { id: "pv-12", status: "finished", committee: { name: "Economics" }, speakers: ["Smith", "Jones"] },
    });

    expect(insights).toEqual([
      { key: "Event Watch · Hearing", value: "pv-12" },
      { key: "Event Watch · Sitting day", value: "4" },
      { key: "Event Watch · id", value: "pv-12" },
      { key: "Event Watch · status", value: "finished" },
      { key: "Event Watch · committee.name", value: "Economics" },
      { key: "Event Watch · speakers", value: "Smith, Jones" },
    ]);
  });

  it("tags a webhook's body as the webhook's", () => {
    expect(runStartedInsights({ origin: "webhook", declared: [], inputs: {}, raw: { note: "Late start" } })).toEqual([
      { key: "Webhook · note", value: "Late start" },
    ]);
  });

  it("records nothing from a payload too large to have been stored", () => {
    expect(
      runStartedInsights({ origin: "watch", declared: [], inputs: {}, raw: { truncated: true, bytes: 900000 } }),
    ).toEqual([]);
  });

  it("caps how many fields and how much of each value it records", () => {
    const raw = Object.fromEntries(Array.from({ length: 80 }, (_, index) => [`field_${index}`, "x".repeat(900)]));

    const insights = runStartedInsights({ origin: "watch", declared: [], inputs: {}, raw });

    expect(insights).toHaveLength(50);
    expect(insights[0]!.value.length).toBeLessThanOrEqual(500);
  });
});
