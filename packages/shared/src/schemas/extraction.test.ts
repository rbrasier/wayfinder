import { describe, expect, it } from "vitest";
import { fieldProposalSchema } from "./extraction";

const validField = {
  label: "Supplier Name",
  annotation: "Supplier Name (text)",
  instruction: "The legal name of the supplier, usually on the cover page.",
};

describe("fieldProposalSchema", () => {
  it("accepts a well-formed proposal", () => {
    const result = fieldProposalSchema.safeParse({ fields: [validField] });

    expect(result.success).toBe(true);
    expect(result.data?.fields).toHaveLength(1);
    expect(result.data?.fields.at(0)?.annotation).toBe("Supplier Name (text)");
  });

  it("accepts an empty field list, which is how a proposer says it found nothing", () => {
    const result = fieldProposalSchema.safeParse({ fields: [] });

    expect(result.success).toBe(true);
  });

  it("rejects a field with an empty label", () => {
    const result = fieldProposalSchema.safeParse({ fields: [{ ...validField, label: "" }] });

    expect(result.success).toBe(false);
  });

  it("rejects a field with an empty instruction", () => {
    const result = fieldProposalSchema.safeParse({ fields: [{ ...validField, instruction: "" }] });

    expect(result.success).toBe(false);
  });

  it("rejects a field with an empty annotation", () => {
    const result = fieldProposalSchema.safeParse({ fields: [{ ...validField, annotation: "" }] });

    expect(result.success).toBe(false);
  });

  it("rejects a proposal that is not shaped as a fields object", () => {
    expect(fieldProposalSchema.safeParse([validField]).success).toBe(false);
  });
});
