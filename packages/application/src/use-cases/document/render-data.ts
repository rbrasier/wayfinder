import type { TemplateField } from "@rbrasier/domain";

// docxtemplater gates {{#section}} blocks on truthiness, and every non-empty
// string is truthy — so a section's "Yes"/"No" must become a real boolean,
// while ordinary placeholders stay strings. Shared by document generation and
// manual editing so the two render paths cannot drift.
export const buildRenderData = (
  fields: TemplateField[],
  values: Record<string, string>,
): Record<string, string | boolean> => {
  const renderData: Record<string, string | boolean> = {};
  for (const field of fields) {
    const value = values[field.key] ?? "";
    renderData[field.key] = field.type === "section" ? value === "Yes" : value;
  }
  return renderData;
};
