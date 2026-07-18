import type { TemplateField } from "@rbrasier/domain";
import type { DocumentData, GroupItems } from "@rbrasier/shared";

// docxtemplater gates {{#section}} blocks on truthiness, and every non-empty
// string is truthy — so a section's "Yes"/"No" must become a real boolean,
// while ordinary placeholders stay strings and a repeating {{#group (repeat)}}
// binds to its array of item records (paragraphLoop iterates it). Shared by
// document generation and manual editing so the two render paths cannot drift.
export const buildRenderData = (
  fields: TemplateField[],
  values: DocumentData,
): Record<string, string | boolean | GroupItems> => {
  const renderData: Record<string, string | boolean | GroupItems> = {};
  for (const field of fields) {
    if (field.type === "group") {
      const value = values[field.key];
      renderData[field.key] = Array.isArray(value) ? value : [];
      continue;
    }
    const value = values[field.key];
    const stringValue = typeof value === "string" ? value : "";
    renderData[field.key] = field.type === "section" ? stringValue === "Yes" : stringValue;
  }
  return renderData;
};
