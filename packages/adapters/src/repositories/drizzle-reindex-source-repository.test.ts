import { describe, expect, it } from "vitest";
import { templateReindexDocument } from "./drizzle-reindex-source-repository";

describe("templateReindexDocument", () => {
  it("indexes a template's extracted text under its storage path", () => {
    const document = templateReindexDocument("flow-1", {
      documentTemplatePath: "templates/brief.docx",
      documentTemplateContent: "Name: {{Full Name}}",
      documentTemplateFilename: "brief.docx",
    });

    expect(document).toEqual({
      flowId: "flow-1",
      sessionId: null,
      sourceType: "template",
      storagePath: "templates/brief.docx",
      filename: "brief.docx",
      text: "Name: {{Full Name}}",
    });
  });

  // Template chunks are retrieved into the same system prompt that gathers
  // fields, so an indexed signature tag is the template-body leak arriving by a
  // second route (ADR-043 §2).
  it("never indexes a signature slot", () => {
    const document = templateReindexDocument("flow-1", {
      documentTemplatePath: "templates/instrument.docx",
      documentTemplateContent: "Name: {{Full Name}}\nSigned: {{ Delegate Signature (approval) }}",
    });

    expect(document?.text).toBe("Name: {{Full Name}}");
    expect(document?.text).not.toContain("(approval)");
    expect(document?.text).not.toContain("Delegate Signature");
  });

  it("falls back to the storage path's basename when no filename is stored", () => {
    const document = templateReindexDocument("flow-1", {
      documentTemplatePath: "templates/nested/instrument.docx",
      documentTemplateContent: "Name: {{Full Name}}",
    });

    expect(document?.filename).toBe("instrument.docx");
  });

  it("skips a node with no template path or no extracted text", () => {
    expect(
      templateReindexDocument("flow-1", { documentTemplateContent: "Name: {{Full Name}}" }),
    ).toBeNull();
    expect(
      templateReindexDocument("flow-1", { documentTemplatePath: "templates/brief.docx" }),
    ).toBeNull();
    expect(
      templateReindexDocument("flow-1", {
        documentTemplatePath: "templates/brief.docx",
        documentTemplateContent: "   ",
      }),
    ).toBeNull();
  });

  it("skips a template whose only content is a signature slot", () => {
    // Nothing gatherable is left to retrieve, so the chunk would be noise at
    // best and a leak at worst.
    expect(
      templateReindexDocument("flow-1", {
        documentTemplatePath: "templates/annexe.docx",
        documentTemplateContent: "{{ Annexe Signature (approval) }}",
      }),
    ).toBeNull();
  });
});
