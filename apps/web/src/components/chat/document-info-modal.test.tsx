import { describe, expect, it } from "vitest";
import { DocumentInfoModal } from "./document-info-modal";

describe("DocumentInfoModal", () => {
  it("exports a function component", () => {
    expect(typeof DocumentInfoModal).toBe("function");
  });

  it("component name is DocumentInfoModal", () => {
    expect(DocumentInfoModal.name).toBe("DocumentInfoModal");
  });
});
