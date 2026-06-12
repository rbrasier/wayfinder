import { describe, it, expect } from "vitest";
import { KeywordColumnMappingDetector } from "./keyword-column-mapping-detector";

describe("KeywordColumnMappingDetector", () => {
  const detector = new KeywordColumnMappingDetector();

  it("maps obvious headers to their canonical field kinds", async () => {
    const result = await detector.detect({
      headers: ["Email", "Full Name", "Line Manager", "Job Title", "Band", "Business Unit"],
      sampleRows: [],
    });

    expect(result.error).toBeUndefined();
    expect(result.data).toEqual({
      Email: "email",
      "Full Name": "name",
      "Line Manager": "manager",
      "Job Title": "position",
      Band: "band",
      "Business Unit": "unit",
    });
  });

  it("omits headers that match no known field kind", async () => {
    const result = await detector.detect({
      headers: ["Email", "Employee ID", "Start Date"],
      sampleRows: [],
    });

    expect(result.data).toEqual({ Email: "email" });
  });

  it("is case-insensitive", async () => {
    const result = await detector.detect({
      headers: ["EMAIL", "full name", "SuperVisor"],
      sampleRows: [],
    });

    expect(result.data).toEqual({
      EMAIL: "email",
      "full name": "name",
      SuperVisor: "manager",
    });
  });

  it("prefers the more specific manager match over name for a manager column", async () => {
    const result = await detector.detect({ headers: ["Manager Name"], sampleRows: [] });

    expect(result.data).toEqual({ "Manager Name": "manager" });
  });
});
