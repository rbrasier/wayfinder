import { describe, expect, it } from "vitest";
import { hearingsAt } from "./hearings.mjs";
import { hearingListText, transcriptText } from "./tools.mjs";

const PERIOD = 5 * 60 * 1000;
const NOW = 5_000_000 * PERIOD + 1_000;

describe("hearingListText", () => {
  it("lists each hearing on its own line with its id and status", () => {
    const text = hearingListText(NOW, PERIOD, null);

    for (const hearing of hearingsAt(NOW, { periodMs: PERIOD })) {
      expect(text).toContain(`${hearing.id} [${hearing.status}]`);
    }
  });

  it("filters by status", () => {
    const text = hearingListText(NOW, PERIOD, "live");

    expect(text.trim().split("\n")).toHaveLength(1);
    expect(text).toContain("[live]");
  });
});

describe("transcriptText", () => {
  it("returns a finished hearing's transcript under its title", () => {
    const finished = hearingsAt(NOW, { periodMs: PERIOD }).find((hearing) => hearing.status === "finished");

    const result = transcriptText(finished.id, NOW, PERIOD);

    expect(result.isError).toBe(false);
    expect(result.text).toContain(finished.title);
    expect(result.text).toContain("CHAIR:");
  });

  it("says when a hearing has not started yet", () => {
    const scheduled = hearingsAt(NOW, { periodMs: PERIOD }).find((hearing) => hearing.status === "scheduled");

    expect(transcriptText(scheduled.id, NOW, PERIOD)).toEqual({
      isError: true,
      text: `${scheduled.id} has not started, so there is no transcript yet.`,
    });
  });

  it("says when there is no such hearing", () => {
    expect(transcriptText("nope", NOW, PERIOD)).toEqual({ isError: true, text: "No hearing with id nope." });
  });
});
