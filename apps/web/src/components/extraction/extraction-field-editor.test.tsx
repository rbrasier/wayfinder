import { describe, expect, it } from "vitest";
import { ExtractionFieldEditor } from "./extraction-field-editor";

describe("ExtractionFieldEditor", () => {
  it("exports a function component", () => {
    expect(typeof ExtractionFieldEditor).toBe("function");
  });

  it("component name is ExtractionFieldEditor", () => {
    expect(ExtractionFieldEditor.name).toBe("ExtractionFieldEditor");
  });
});
