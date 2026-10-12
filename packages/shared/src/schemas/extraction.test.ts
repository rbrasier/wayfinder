import { describe, expect, it } from "vitest";
import { buildExtractionResultSchema, fileGroupingSchema } from "./extraction";

const field = (overrides: Record<string, unknown> = {}) => ({
  value: "Acme Pty Ltd",
  confidence: 90,
  rationale: "Cover page.",
  ...overrides,
});

describe("buildExtractionResultSchema", () => {
  const schema = buildExtractionResultSchema(["supplier"]);

  it("rounds a fractional 0-100 confidence instead of rejecting the record", () => {
    const parsed = schema.safeParse({ supplier: field({ confidence: 87.5 }) });

    expect(parsed.success).toBe(true);
    expect(parsed.data?.supplier?.confidence).toBe(88);
  });

  it("scales a 0-1 confidence onto the 0-100 band", () => {
    const parsed = schema.safeParse({ supplier: field({ confidence: 0.85 }) });

    expect(parsed.data?.supplier?.confidence).toBe(85);
  });

  it("clamps an out-of-range confidence", () => {
    expect(schema.safeParse({ supplier: field({ confidence: 140 }) }).data?.supplier?.confidence).toBe(100);
    expect(schema.safeParse({ supplier: field({ confidence: -5 }) }).data?.supplier?.confidence).toBe(0);
  });

  it("keeps whole-number confidences, including 1, unchanged", () => {
    expect(schema.safeParse({ supplier: field({ confidence: 1 }) }).data?.supplier?.confidence).toBe(1);
    expect(schema.safeParse({ supplier: field({ confidence: 72 }) }).data?.supplier?.confidence).toBe(72);
  });

  it("accepts a field entry the model sent as a JSON string", () => {
    const parsed = schema.safeParse({ supplier: JSON.stringify(field()) });

    expect(parsed.success).toBe(true);
    expect(parsed.data?.supplier?.value).toBe("Acme Pty Ltd");
  });
});

describe("fileGroupingSchema", () => {
  it("accepts fileIds the model sent as a JSON string", () => {
    const parsed = fileGroupingSchema.safeParse({
      records: [{ label: "Acme", fileIds: JSON.stringify(["f1", "f2"]) }],
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data?.records[0]?.fileIds).toEqual(["f1", "f2"]);
  });

  it("accepts a records array the model sent as a JSON string", () => {
    const parsed = fileGroupingSchema.safeParse({
      records: JSON.stringify([{ label: "Acme", fileIds: ["f1"] }]),
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data?.records).toEqual([{ label: "Acme", fileIds: ["f1"] }]);
  });

  it("still rejects a string that is not JSON", () => {
    expect(fileGroupingSchema.safeParse({ records: [{ label: "Acme", fileIds: "f1, f2" }] }).success).toBe(false);
  });
});
