import { deriveFieldKey, type TemplateField } from "@rbrasier/domain";
import type { DocumentData, GroupItems } from "@rbrasier/shared";

// {{ Department.key }} normalises to the render key `department_key` (the docx
// generator strips punctuation the same way the parser does), so the accessor
// needs no nested data and no dotted path (ADR-050 §3).
export const keyAccessorRenderKey = (fieldKey: string): string => deriveFieldKey(`${fieldKey}.key`);

// docxtemplater gates {{#section}} blocks on truthiness, and every non-empty
// string is truthy — so a section's "Yes"/"No" must become a real boolean,
// while ordinary placeholders stay strings and a repeating {{#group (repeat)}}
// binds to its array of item records (paragraphLoop iterates it). Shared by
// document generation and manual editing so the two render paths cannot drift.
export const buildRenderData = (
  fields: TemplateField[],
  values: DocumentData,
  // Keys attached by the step-end resolve, by field key. A field whose source
  // declares no key field is absent, and its accessor renders empty.
  valueKeys: Record<string, string> = {},
): Record<string, string | boolean | GroupItems> => {
  const renderData: Record<string, string | boolean | GroupItems> = {};
  for (const field of fields) {
    if (field.optionsSource) {
      renderData[keyAccessorRenderKey(field.key)] = valueKeys[field.key] ?? "";
    }
    if (field.type === "group") {
      const value = values[field.key];
      renderData[field.key] = Array.isArray(value) ? value : [];
      continue;
    }
    const value = values[field.key];
    const stringValue = typeof value === "string" ? value : "";
    // A signature carries the attestation block frozen into the deciding
    // approval's record, supplied by the caller. Absent means undecided, which
    // renders as an empty string: a document must never imply an approval that
    // has not happened (ADR-043 §3). `linebreaks: true` on the generator turns
    // the block's newlines into real breaks.
    renderData[field.key] = field.type === "section" ? stringValue === "Yes" : stringValue;
  }
  return renderData;
};
