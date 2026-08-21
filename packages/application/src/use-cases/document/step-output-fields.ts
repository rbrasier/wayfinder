import type { FieldValueSnapshot, StepOutputField, TemplateField } from "@rbrasier/domain";
import type { DocumentData, GroupItems } from "@rbrasier/shared";

// What the step-end resolve attached to an external-sourced field, by field key.
export interface ResolvedExternalValues {
  [fieldKey: string]: { valueKey?: string; sourceRef: FieldValueSnapshot };
}

// Maps extracted field values onto the format-neutral StepOutputField shape that
// every consumer (manual editing, Insights, the record card) reads. A group
// keeps its extracted items and a blank scalar value; scalars keep their string
// value (blanked when missing). Shared by document generation and structured
// capture so both persist an identical record (ADR-038 §2).
export const buildStepOutputFields = (
  fields: TemplateField[],
  values: DocumentData,
  resolved: ResolvedExternalValues = {},
): StepOutputField[] =>
  fields.map((field) => {
    if (field.type === "group") {
      const value = values[field.key];
      const items: GroupItems = Array.isArray(value) ? value : [];
      return { key: field.key, label: field.label, type: field.type, options: field.options, value: "", items };
    }
    const value = values[field.key];
    const external = resolved[field.key];
    return {
      key: field.key,
      label: field.label,
      type: field.type,
      // An external field carries no options: the valid set lives in the source
      // and a copy here would disagree with sourceRef.version (ADR-050 §4).
      options: field.optionsSource ? undefined : field.options,
      value: typeof value === "string" ? value : "",
      ...(external?.valueKey ? { valueKey: external.valueKey } : {}),
      ...(external ? { sourceRef: external.sourceRef } : {}),
    };
  });
