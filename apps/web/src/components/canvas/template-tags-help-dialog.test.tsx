import { describe, expect, it } from "vitest";
import { TemplateTagsHelpDialog } from "./template-tags-help-dialog";

describe("TemplateTagsHelpDialog", () => {
  it("exports a function component", () => {
    expect(typeof TemplateTagsHelpDialog).toBe("function");
  });

  it("component name is TemplateTagsHelpDialog", () => {
    expect(TemplateTagsHelpDialog.name).toBe("TemplateTagsHelpDialog");
  });
});
