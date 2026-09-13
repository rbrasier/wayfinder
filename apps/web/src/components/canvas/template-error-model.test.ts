import { describe, it, expect } from "vitest";
import { toTemplateError } from "./template-error-model";

describe("toTemplateError", () => {
  it("keeps the server's headline and every named tag", () => {
    const result = toTemplateError(
      {
        error: "2 tags in this template are not correctly formed.",
        details: [
          { subject: "Extension Options: {[ Amount", message: "A tag opens with a stray brace." },
          { subject: "{{ Client Name }]", message: "A tag never closes." },
        ],
      },
      "Could not read that document.",
    );

    expect(result.headline).toBe("2 tags in this template are not correctly formed.");
    expect(result.details.map((detail) => detail.subject)).toEqual([
      "Extension Options: {[ Amount",
      "{{ Client Name }]",
    ]);
  });

  it("falls back when the payload carries no message", () => {
    expect(toTemplateError({}, "Could not read that document.")).toEqual({
      headline: "Could not read that document.",
      details: [],
    });
  });

  it("falls back when the response is not an object at all", () => {
    expect(toTemplateError(null, "Could not save the template.").headline).toBe(
      "Could not save the template.",
    );
  });

  it("collapses a tag reported once per page of a repeated header", () => {
    const repeated = { subject: "Ref: {[ Broken", message: "A tag opens with a stray brace." };

    const result = toTemplateError({ error: "Broken", details: [repeated, repeated] }, "fallback");

    expect(result.details).toHaveLength(1);
  });

  it("drops entries that name no text to point at", () => {
    const result = toTemplateError(
      {
        error: "Broken",
        details: [{ message: "Something is wrong" }, { subject: "  " }, "not an object", null],
      },
      "fallback",
    );

    expect(result.details).toEqual([]);
  });

  it("ignores a details field that is not a list", () => {
    expect(toTemplateError({ error: "Broken", details: "oops" }, "fallback").details).toEqual([]);
  });
});
