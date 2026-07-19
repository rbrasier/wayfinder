import type { StepOutputField, TemplateField } from "@rbrasier/domain";
import type { DocumentData, GroupItems } from "@rbrasier/shared";

// Maps extracted field values onto the format-neutral StepOutputField shape that
// every consumer (manual editing, Insights, the record card) reads. A group
// keeps its extracted items and a blank scalar value; scalars keep their string
// value (blanked when missing). Shared by document generation and structured
// capture so both persist an identical record (ADR-038 §2).
export const buildStepOutputFields = (
  fields: TemplateField[],
  values: DocumentData,
): StepOutputField[] =>
  fields.map((field) => {
    if (field.type === "group") {
      const value = values[field.key];
      const items: GroupItems = Array.isArray(value) ? value : [];
      return { key: field.key, label: field.label, type: field.type, options: field.options, value: "", items };
    }
    const value = values[field.key];
    return {
      key: field.key,
      label: field.label,
      type: field.type,
      options: field.options,
      value: typeof value === "string" ? value : "",
    };
  });
