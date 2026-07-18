import type { TemplateField } from "./template-field";

// A required sub-field is one the item must carry a value for. Narrative and
// section sub-fields are never "missing" (narrative is composed, section is a
// gate), and optional sub-fields may be blank — mirroring the top-level rules.
const isRequiredSubField = (subField: TemplateField): boolean =>
  !subField.optional && subField.type !== "narrative" && subField.type !== "section";

// Soft intake-completeness signals for a repeating group's extracted items. Not
// a hard failure — best-effort coercion already kept the turn alive; these notes
// let the operator react to an empty list or an item missing required data
// ("no suppliers were extracted"; "Supplier B has no Pricing finding"). Pure and
// side-effect free; the caller decides how to surface them.
export const computeGroupCompletenessNotes = (
  field: TemplateField,
  items: Array<Record<string, string>>,
): string[] => {
  if (field.type !== "group") return [];

  if (items.length === 0) {
    return [
      `No "${field.label}" items were extracted — add the missing information or confirm there are none.`,
    ];
  }

  const requiredSubFields = (field.itemFields ?? []).filter(isRequiredSubField);
  const notes: string[] = [];
  items.forEach((item, index) => {
    const missing = requiredSubFields
      .filter((subField) => (item[subField.key] ?? "").trim() === "")
      .map((subField) => subField.label);
    if (missing.length > 0) {
      notes.push(`"${field.label}" item ${index + 1} is missing: ${missing.join(", ")}.`);
    }
  });
  return notes;
};
