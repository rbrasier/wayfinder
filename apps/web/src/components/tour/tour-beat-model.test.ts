import { describe, it, expect } from "vitest";
import { advanceBeat, beatDelay, restingBeat } from "./tour-beat-model";

const durations = [400, 900, 900, 2400] as const;

describe("advanceBeat", () => {
  it("moves to the next beat", () => {
    expect(advanceBeat(0, durations.length)).toBe(1);
    expect(advanceBeat(2, durations.length)).toBe(3);
  });

  it("loops back to the start after the final beat, so the illustration replays", () => {
    expect(advanceBeat(3, durations.length)).toBe(0);
  });
});

describe("beatDelay", () => {
  it("holds each beat for its own duration", () => {
    expect(beatDelay(0, durations)).toBe(400);
    expect(beatDelay(3, durations)).toBe(2400);
  });

  it("falls back to a readable pause for a beat with no duration, rather than a flicker", () => {
    expect(beatDelay(9, durations)).toBeGreaterThanOrEqual(800);
  });
});

describe("restingBeat", () => {
  it("is the finished frame, which reduced motion holds instead of looping", () => {
    expect(restingBeat(durations)).toBe(3);
  });
});
