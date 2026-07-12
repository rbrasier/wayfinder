import { describe, expect, it } from "vitest";
import { TEMPLATE_COMPLETE_SENTINEL, doneWhenForOutputType } from "./output-type";

describe("doneWhenForOutputType", () => {
  it("defaults to template complete when selecting generate document with no condition", () => {
    expect(
      doneWhenForOutputType("generate_document", { doneWhen: "", neverDone: false }),
    ).toBe(TEMPLATE_COMPLETE_SENTINEL);
  });

  it("treats a whitespace-only condition as empty and defaults to template complete", () => {
    expect(
      doneWhenForOutputType("generate_document", { doneWhen: "   ", neverDone: false }),
    ).toBe(TEMPLATE_COMPLETE_SENTINEL);
  });

  it("keeps an existing specific condition when selecting generate document", () => {
    expect(
      doneWhenForOutputType("generate_document", {
        doneWhen: "the applicant confirms their details",
        neverDone: false,
      }),
    ).toBe("the applicant confirms their details");
  });

  it("keeps doneWhen empty when the step is never done", () => {
    expect(
      doneWhenForOutputType("generate_document", { doneWhen: "", neverDone: true }),
    ).toBe("");
  });

  it("clears the template-complete sentinel when reverting to conversation only", () => {
    expect(
      doneWhenForOutputType("conversation_only", {
        doneWhen: TEMPLATE_COMPLETE_SENTINEL,
        neverDone: false,
      }),
    ).toBe("");
  });

  it("preserves a specific condition when reverting to conversation only", () => {
    expect(
      doneWhenForOutputType("conversation_only", {
        doneWhen: "the applicant confirms their details",
        neverDone: false,
      }),
    ).toBe("the applicant confirms their details");
  });
});
