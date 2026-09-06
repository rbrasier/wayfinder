import { describe, expect, it } from "vitest";
import { helpDialogContent } from "./template-tags-help-content";

describe("helpDialogContent", () => {
  const sectionTitles = (variant: "template" | "structured") =>
    helpDialogContent(variant).sections.map((section) => section.title);

  const allAnnotations = (variant: "template" | "structured") =>
    helpDialogContent(variant).sections.flatMap((section) =>
      section.rows.map((row) => row.annotation),
    );

  it("keeps every section for a document template", () => {
    expect(sectionTitles("template")).toEqual([
      "Type keywords",
      "Options / enum",
      "Constraints",
      "Narrative prose",
      "Signatures",
      "Optional sections",
      "Repeating groups",
    ]);
  });

  it("offers a structured step the types it can actually author", () => {
    expect(sectionTitles("structured")).toEqual([
      "Type keywords",
      "Options / enum",
      "Constraints",
      "Narrative prose",
    ]);
  });

  // Each of these is rejected by validateStructuredFieldSet or is a document
  // rendering construct — offering them would document a field the author
  // cannot save.
  it("withholds signatures, sections and repeating groups from a structured step", () => {
    const annotations = allAnnotations("structured").join(" ");
    expect(annotations).not.toContain("(approval)");
    expect(annotations).not.toContain("{{#Section Name}}");
    expect(annotations).not.toContain("(repeat)");
  });

  it("still documents narrative and its brief in a structured step", () => {
    expect(allAnnotations("structured")).toEqual(
      expect.arrayContaining(["(narrative)", '(narrative: "brief")']),
    );
  });

  it("drops .docx and tag framing from the structured intro and examples", () => {
    const { intro, examples, title } = helpDialogContent("structured");
    expect(title).not.toContain("Template tags");
    expect(intro).not.toContain(".docx");
    expect(examples.join("\n")).not.toContain("{{");
  });

  it("keeps the .docx framing for a document template", () => {
    const { intro, examples, title } = helpDialogContent("template");
    expect(title).toContain("Template tags");
    expect(intro).toContain(".docx");
    expect(examples.join("\n")).toContain("{{");
  });
});
