import { DEFAULT_ITEM_CAP, validateTemplateFieldValue, type TemplateField } from "@rbrasier/domain";
import type { GroupItems } from "@rbrasier/shared";

export interface GroupItemError {
  key: string;
  message: string;
}

export interface ValidatedGroupItems {
  items: GroupItems;
  errors: GroupItemError[];
}

// Validates a manually-edited repeating group's submitted items against the
// group's itemFields, reusing the same per-field validation as scalar edits.
// A fully-blank row is dropped (the trailing empty row an author left behind);
// a row with any content must satisfy each required sub-field. Enforces the
// group's itemCap. Pure — never throws; errors are keyed to the group field so
// the edit dialog can surface them under the group.
export const validateGroupItems = (
  field: TemplateField,
  rawItems: Array<Record<string, string>>,
): ValidatedGroupItems => {
  const subFields = field.itemFields ?? [];
  const cap = field.itemCap ?? DEFAULT_ITEM_CAP;
  const items: GroupItems = [];
  const errors: GroupItemError[] = [];

  if (rawItems.length > cap) {
    errors.push({
      key: field.key,
      message: `"${field.label}" allows at most ${cap} item${cap === 1 ? "" : "s"}.`,
    });
  }

  rawItems.forEach((rawItem, index) => {
    const isBlank = subFields.every((subField) => (rawItem[subField.key] ?? "").trim() === "");
    if (isBlank) return;

    const item: Record<string, string> = {};
    for (const subField of subFields) {
      const validated = validateTemplateFieldValue(subField, rawItem[subField.key] ?? "");
      if (validated.error) {
        errors.push({ key: field.key, message: `Item ${index + 1} — ${validated.error.message}` });
        continue;
      }
      item[subField.key] = validated.data;
    }
    items.push(item);
  });

  return { items, errors };
};
