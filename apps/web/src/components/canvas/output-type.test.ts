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

  it("clears the template-complete sentinel when reverting to an unstructured conversation", () => {
    expect(
      doneWhenForOutputType("unstructured", {
        doneWhen: TEMPLATE_COMPLETE_SENTINEL,
        neverDone: false,
      }),
    ).toBe("");
  });

  it("preserves a specific condition when reverting to an unstructured conversation", () => {
    expect(
      doneWhenForOutputType("unstructured", {
        doneWhen: "the applicant confirms their details",
        neverDone: false,
      }),
    ).toBe("the applicant confirms their details");
  });

  it("defaults to all-fields-captured when selecting a structured conversation with no condition", () => {
    expect(
      doneWhenForOutputType("structured", { doneWhen: "", neverDone: false }),
    ).toBe(TEMPLATE_COMPLETE_SENTINEL);
  });

  it("keeps an existing specific condition when selecting a structured conversation", () => {
    expect(
      doneWhenForOutputType("structured", {
        doneWhen: "the reviewer signs off",
        neverDone: false,
      }),
    ).toBe("the reviewer signs off");
  });

  it("keeps doneWhen empty when a structured step is never done", () => {
    expect(
      doneWhenForOutputType("structured", { doneWhen: "", neverDone: true }),
    ).toBe("");
  });
});
