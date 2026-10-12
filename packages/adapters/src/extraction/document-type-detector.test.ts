import { describe, expect, it } from "vitest";
import { SniffingDocumentTypeDetector } from "./document-type-detector";

describe("SniffingDocumentTypeDetector", () => {
  const detector = new SniffingDocumentTypeDetector();

  it("types a file from its content and name", () => {
    expect(detector.detect(Buffer.from("a,b"), "pricing.csv").data).toBe("text/csv");
  });

  it("returns null for a type extraction cannot read", () => {
    expect(detector.detect(Buffer.from("legacy"), "pricing.xls").data).toBeNull();
  });
});
