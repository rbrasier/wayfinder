import { describe, expect, it } from "vitest";
import { RECOMMENDED_MAX_STEP_TOOLS, toolCountAdvice } from "./tool-count-advice";

describe("toolCountAdvice", () => {
  it("says nothing up to the recommended number of tools", () => {
    expect(toolCountAdvice(0)).toBeNull();
    expect(toolCountAdvice(RECOMMENDED_MAX_STEP_TOOLS)).toBeNull();
  });

  it("warns, without blocking, once a step has more tools than that", () => {
    expect(toolCountAdvice(RECOMMENDED_MAX_STEP_TOOLS + 1)).toBe(
      `This step has ${RECOMMENDED_MAX_STEP_TOOLS + 1} tools. More than ${RECOMMENDED_MAX_STEP_TOOLS} makes it slower to reply and likelier to pick the wrong one — keep only the tools this step needs.`,
    );
  });

  it("recommends at most eight tools", () => {
    expect(RECOMMENDED_MAX_STEP_TOOLS).toBe(8);
  });
});
