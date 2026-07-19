import { describe, expect, it } from "vitest";
import { parseFieldLines } from "./template-field-editor";

describe("parseFieldLines", () => {
  it("parses valid Label (type) lines into TemplateFields and ignores blanks", () => {
    const result = parseFieldLines(["Preferred Vendor (text)", "", "Approved (yesno)"]);

    expect(result.valid).toBe(true);
    expect(result.fields).toHaveLength(2);
    expect(result.fields[0]!.key).toBe("preferred_vendor");
    expect(result.fields[1]!.type).toBe("yesno");
  });

  it("flags a malformed annotation as invalid (same parser as .docx tags)", () => {
    const result = parseFieldLines(["Vendor (maxlen: abc)"]);

    expect(result.valid).toBe(false);
  });

  it("is valid and empty when there are no non-blank lines", () => {
    const result = parseFieldLines(["", "  "]);

    expect(result.valid).toBe(true);
    expect(result.fields).toHaveLength(0);
  });

  it("allows a section line by default", () => {
    const result = parseFieldLines(["#Optional Clause"]);

    expect(result.valid).toBe(true);
    expect(result.fields[0]!.type).toBe("section");
  });

  it("rejects a section line and excludes it when disallowSection is set", () => {
    const result = parseFieldLines(["Decision (text)", "#Optional Clause"], {
      disallowSection: true,
    });

    expect(result.valid).toBe(false);
    expect(result.fields).toHaveLength(1);
    expect(result.fields[0]!.key).toBe("decision");
  });
});
