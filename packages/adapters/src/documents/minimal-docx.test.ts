import { describe, expect, it } from "vitest";
import { buildMinimalDocx } from "./minimal-docx";
import { DocxGenerator } from "./docx-generator";

describe("buildMinimalDocx", () => {
  it("builds a .docx the generator can render, one paragraph per line", () => {
    const template = buildMinimalDocx(["Delegation to {{Delegate Name}}.", "{{ Delegate Signature (approval) }}"]);

    const fields = new DocxGenerator().extractFields({ templateBytes: template });

    expect(fields.data?.fields.map((field) => field.key)).toEqual(["delegate_name", "delegate_signature"]);
  });

  it("escapes XML in the text", () => {
    const docx = buildMinimalDocx(["Smith & Sons <Ltd>"]);

    const text = new DocxGenerator().extractFullText({ templateBytes: docx });

    expect(text.data?.text).toContain("Smith & Sons <Ltd>");
  });
});
