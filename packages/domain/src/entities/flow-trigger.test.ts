import { describe, expect, it } from "vitest";
import { validateTriggerInputs, validateTriggerPayload, type TriggerInput } from "./flow-trigger";

const inputs: TriggerInput[] = [
  { key: "hearing_id", label: "Hearing ID", type: "text", required: true },
  { key: "sitting_day", label: "Sitting day", type: "number", required: false },
  { key: "finished", label: "Finished", type: "boolean", required: false },
  { key: "held_on", label: "Held on", type: "date", required: false },
  { key: "details", label: "Details", type: "json", required: false },
];

describe("validateTriggerPayload", () => {
  it("keeps declared inputs and coerces numbers, booleans and dates from strings", () => {
    const result = validateTriggerPayload(inputs, {
      hearing_id: "H-123",
      sitting_day: "4",
      finished: "true",
      held_on: "2026-10-21",
      details: { room: "2S1" },
    });

    expect(result.data).toEqual({
      hearing_id: "H-123",
      sitting_day: 4,
      finished: true,
      held_on: "2026-10-21",
      details: { room: "2S1" },
    });
  });

  it("drops keys the flow does not declare", () => {
    const result = validateTriggerPayload(inputs, { hearing_id: "H-1", injected: "<script>" });

    expect(result.data).toEqual({ hearing_id: "H-1" });
  });

  it("names every invalid or missing input in one error", () => {
    const result = validateTriggerPayload(inputs, { sitting_day: "four", held_on: "yesterday" });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toBe(
      "hearing_id is required. sitting_day must be a number. held_on must be a date (YYYY-MM-DD).",
    );
  });

  it("treats a blank required text input as missing", () => {
    const result = validateTriggerPayload(inputs, { hearing_id: "   " });

    expect(result.error?.message).toBe("hearing_id is required.");
  });

  it("rejects a payload that is not an object", () => {
    expect(validateTriggerPayload(inputs, ["H-1"]).error?.code).toBe("VALIDATION_FAILED");
  });
});

describe("validateTriggerInputs", () => {
  it("accepts snake-case keys that are unique", () => {
    expect(validateTriggerInputs(inputs)).toEqual([]);
  });

  it("rejects malformed and duplicate keys and blank labels", () => {
    const problems = validateTriggerInputs([
      { key: "Hearing ID", label: "Hearing", type: "text", required: true },
      { key: "dup", label: "One", type: "text", required: false },
      { key: "dup", label: "", type: "text", required: false },
    ]);

    expect(problems).toEqual([
      "Hearing ID must start with a letter and use only lower-case letters, digits and underscores.",
      "dup is used more than once.",
      "Give dup a label.",
    ]);
  });
});
