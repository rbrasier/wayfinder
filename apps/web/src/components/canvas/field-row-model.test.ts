import { describe, it, expect } from "vitest";
import {
  emptyModel,
  hasNonDefaultConfig,
  lineToModel,
  linesToModels,
  modelToLine,
  STRUCTURED_TYPE_OPTIONS,
  TEMPLATE_TYPE_OPTIONS,
  withType,
  type FieldModel,
} from "./field-row-model";

const model = (overrides: Partial<FieldModel> = {}): FieldModel => ({
  ...emptyModel(),
  label: "Supplier Name",
  ...overrides,
});

describe("lineToModel", () => {
  it("reads a bare label as a required text field", () => {
    expect(lineToModel("Supplier Name")).toMatchObject({
      label: "Supplier Name",
      type: "text",
      optional: false,
    });
  });

  it("reads a type annotation", () => {
    expect(lineToModel("Contract Value (currency)")).toMatchObject({
      label: "Contract Value",
      type: "currency",
    });
  });

  it("reads an options list as a single-select", () => {
    expect(lineToModel("Status (options: Approved, Rejected)")).toMatchObject({
      type: "select",
      options: ["Approved", "Rejected"],
    });
  });

  it("reads a multi-options list as a multi-select", () => {
    expect(lineToModel("Tags (multi-options: A, B)")).toMatchObject({
      type: "multiselect",
      options: ["A", "B"],
    });
  });

  it("reads constraints and optionality", () => {
    expect(lineToModel("Notes (text) (maxlen: 80) (optional)")).toMatchObject({
      maxLength: 80,
      optional: true,
    });
  });

  it("reads a narrative instruction", () => {
    expect(lineToModel('Background (narrative: "Summarise the project")')).toMatchObject({
      type: "narrative",
      instruction: "Summarise the project",
    });
  });

  it("accepts a line still wrapped in braces from Word", () => {
    expect(lineToModel("{{ Supplier Name (text) }}")).toMatchObject({
      label: "Supplier Name",
      type: "text",
    });
  });

  it("degrades an unparseable line to a text field carrying the raw text", () => {
    expect(lineToModel("Supplier (telephone)")).toMatchObject({
      label: "Supplier (telephone)",
      type: "text",
    });
  });

  it("returns an empty model for a blank line", () => {
    expect(lineToModel("   ")).toEqual(emptyModel());
  });

  // Every reviewed row is re-serialised from its model and written back into the
  // stored .docx (buildAnnotationEdits). A signature the editor reads as text is
  // therefore a signature it deletes from the author's own document.
  it("reads an (approval) tag as a signature, not as text", () => {
    expect(lineToModel("Delegate Sign Off (approval)")).toMatchObject({
      label: "Delegate Sign Off",
      type: "signature",
      optional: true,
    });
  });
});

describe("modelToLine", () => {
  it("emits a bare label for an unconstrained text field", () => {
    expect(modelToLine(model())).toBe("Supplier Name");
  });

  it("emits separate parenthesised groups, not a comma-joined list", () => {
    // The grammar splits on each (…) group; a comma form would be read as one
    // unknown annotation and would collide with (options: A, B, C).
    expect(modelToLine(model({ label: "Contract Value", type: "currency", min: 0 }))).toBe(
      "Contract Value (currency) (min: 0)",
    );
  });

  it("omits the type group for text, which is the grammar's default", () => {
    expect(modelToLine(model({ type: "text", maxLength: 80 }))).toBe("Supplier Name (maxlen: 80)");
  });

  it("emits an options annotation for a select", () => {
    expect(modelToLine(model({ label: "Status", type: "select", options: ["A", "B"] }))).toBe(
      "Status (options: A, B)",
    );
  });

  it("emits multi-options for a multiselect", () => {
    expect(modelToLine(model({ label: "Tags", type: "multiselect", options: ["A", "B"] }))).toBe(
      "Tags (multi-options: A, B)",
    );
  });

  it("drops blank choices", () => {
    expect(modelToLine(model({ label: "Status", type: "select", options: ["A", "  ", ""] }))).toBe(
      "Status (options: A)",
    );
  });

  it("emits an empty line for a blank label so the parser skips the row", () => {
    expect(modelToLine(model({ label: "   " }))).toBe("");
  });

  it("round-trips every model back through the parser", () => {
    const original = model({ label: "Notes", type: "text", maxLength: 40, optional: true });
    expect(lineToModel(modelToLine(original))).toMatchObject({
      label: "Notes",
      maxLength: 40,
      optional: true,
    });
  });

  // The keyword is (approval); `signature` is the parsed type name, so emitting
  // the type would produce a line the parser rejects.
  it("emits (approval) for a signature rather than rewriting it as (optional)", () => {
    expect(modelToLine(model({ label: "Delegate Sign Off", type: "signature", optional: true }))).toBe(
      "Delegate Sign Off (approval)",
    );
  });

  it("round-trips a signature through the parser unchanged", () => {
    const line = "Delegate Sign Off (approval)";

    expect(modelToLine(lineToModel(line))).toBe(line);
  });
});

describe("hasNonDefaultConfig", () => {
  it("is false for a plain required text field", () => {
    expect(hasNonDefaultConfig(model())).toBe(false);
  });

  it("is true when the field is optional", () => {
    expect(hasNonDefaultConfig(model({ optional: true }))).toBe(true);
  });

  it("is true when a length limit is set", () => {
    expect(hasNonDefaultConfig(model({ maxLength: 80 }))).toBe(true);
  });

  it("is true when a numeric bound is set", () => {
    expect(hasNonDefaultConfig(model({ min: 1 }))).toBe(true);
    expect(hasNonDefaultConfig(model({ max: 10 }))).toBe(true);
  });

  it("is true when choices are set", () => {
    expect(hasNonDefaultConfig(model({ type: "select", options: ["A"] }))).toBe(true);
  });

  it("is false when the only choices are blank", () => {
    expect(hasNonDefaultConfig(model({ type: "select", options: ["", "  "] }))).toBe(false);
  });

  it("is true when a narrative instruction is set", () => {
    expect(hasNonDefaultConfig(model({ type: "narrative", instruction: "Summarise" }))).toBe(true);
  });

  it("ignores the field type on its own — the type has its own control", () => {
    expect(hasNonDefaultConfig(model({ type: "currency" }))).toBe(false);
  });

  // A signature is optional by construction, not by an author's choice, so the
  // accented cog would fire on every signature row and mean nothing.
  it("ignores a signature's implicit optionality", () => {
    expect(hasNonDefaultConfig(model({ type: "signature", optional: true }))).toBe(false);
  });
});

describe("withType", () => {
  it("clears choices when leaving a select type", () => {
    const changed = withType(model({ type: "select", options: ["A", "B"] }), "text");
    expect(changed.options).toEqual([]);
  });

  it("keeps choices when moving between select types", () => {
    const changed = withType(model({ type: "select", options: ["A"] }), "multiselect");
    expect(changed.options).toEqual(["A"]);
  });

  it("clears numeric bounds carried over from the previous type", () => {
    const changed = withType(model({ type: "number", min: 1, max: 10 }), "text");
    expect(changed.min).toBeUndefined();
    expect(changed.max).toBeUndefined();
  });

  it("keeps the label and optionality", () => {
    const changed = withType(model({ optional: true }), "date");
    expect(changed).toMatchObject({ label: "Supplier Name", optional: true, type: "date" });
  });

  // parseTemplateField rejects a signature carrying any of these, so a switch
  // that kept them would emit a line the author cannot save.
  it("clears every constraint when switching to a signature", () => {
    const changed = withType(
      model({ type: "select", options: ["A"], maxLength: 40, min: 1, max: 10 }),
      "signature",
    );

    expect(changed.options).toEqual([]);
    expect(changed.maxLength).toBeUndefined();
    expect(changed.min).toBeUndefined();
    expect(changed.max).toBeUndefined();
  });

  it("forces a signature optional, matching what the parser produces", () => {
    expect(withType(model({ optional: false }), "signature").optional).toBe(true);
  });

  it("emits a saveable line after a switch to signature", () => {
    expect(modelToLine(withType(model({ type: "number", min: 1 }), "signature"))).toBe(
      "Supplier Name (approval)",
    );
  });
});

describe("linesToModels", () => {
  it("returns one row for an empty list so the editor is never blank", () => {
    expect(linesToModels([])).toHaveLength(1);
  });

  it("maps each line to a model", () => {
    expect(linesToModels(["A (text)", "B (date)"]).map((entry) => entry.type)).toEqual([
      "text",
      "date",
    ]);
  });
});

describe("type options", () => {
  const values = (options: { value: string }[]) => options.map((option) => option.value);

  // ADR-038 §5 hides `section` from the structured editor because an
  // include/omit-this-part-of-the-document decision has no meaning with no
  // document. It says nothing about narrative, and narrative prose composed
  // into the record is meaningful whether or not a document is rendered.
  it("offers narrative in a structured step", () => {
    expect(values(STRUCTURED_TYPE_OPTIONS)).toContain("narrative");
  });

  // ADR-043 §2: no document, no signature.
  it("does not offer a signature in a structured step", () => {
    expect(values(STRUCTURED_TYPE_OPTIONS)).not.toContain("signature");
  });

  it("offers both narrative and signature in a template step", () => {
    expect(values(TEMPLATE_TYPE_OPTIONS)).toEqual(
      expect.arrayContaining(["narrative", "signature"]),
    );
  });

  it("lists each type once", () => {
    for (const options of [STRUCTURED_TYPE_OPTIONS, TEMPLATE_TYPE_OPTIONS]) {
      expect(new Set(values(options)).size).toBe(options.length);
    }
  });

  it("offers the same scalar types to both editors", () => {
    const structured = values(STRUCTURED_TYPE_OPTIONS);
    const template = values(TEMPLATE_TYPE_OPTIONS).filter((value) => value !== "signature");
    expect(structured).toEqual(template);
  });
});

describe("narrative guidance round-trip", () => {
  it("serialises a brief the same way a .docx tag carries it", () => {
    const line = modelToLine(
      model({ label: "Scope", type: "narrative", instruction: "What is in and out of scope" }),
    );
    expect(line).toBe('Scope (narrative: "What is in and out of scope")');
  });

  it("reads its own serialised brief back unchanged", () => {
    const brief = "Cover the background, the options considered, and the recommendation";
    const line = modelToLine(model({ label: "Background", type: "narrative", instruction: brief }));
    expect(lineToModel(line)).toMatchObject({ type: "narrative", instruction: brief });
  });

  it("serialises a narrative with no brief as a bare (narrative)", () => {
    expect(modelToLine(model({ label: "Scope", type: "narrative" }))).toBe("Scope (narrative)");
  });

  it("carries an existing brief onto a switch to narrative", () => {
    const changed = withType(model({ type: "text", instruction: "Two paragraphs" }), "narrative");
    expect(changed.instruction).toBe("Two paragraphs");
  });

  it("drops the brief when switching away from narrative", () => {
    const changed = withType(model({ type: "narrative", instruction: "Two paragraphs" }), "text");
    expect(changed.instruction).toBeUndefined();
  });
});
