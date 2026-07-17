import type { TemplateFieldType } from "./template-field";
import { parseNumeric } from "./analytics";

// A single report cell resolved to its typed form. `isNumeric` is true only when
// a currency/number column held a parseable value — export writes those as real
// numeric cells; everything else (text, dates, enums, unparseable numerics, and
// blanks) is written as text.
export interface DisplayCell {
  value: number | string;
  isNumeric: boolean;
}

const isNumericColumn = (type: TemplateFieldType): boolean =>
  type === "currency" || type === "number";

export const typedDisplayCell = (type: TemplateFieldType, raw: string): DisplayCell => {
  if (raw === "") return { value: "", isNumeric: false };
  if (!isNumericColumn(type)) return { value: raw, isNumeric: false };

  const parsed = parseNumeric(raw);
  if (parsed === null) return { value: raw, isNumeric: false };
  return { value: parsed, isNumeric: true };
};

export const typedCellValue = (type: TemplateFieldType, raw: string): number | string =>
  typedDisplayCell(type, raw).value;

// First non-empty member value for a (possibly collapsed) display column.
// Exclusive routing means at most one member is populated per session; when a
// defensive double-capture occurs we take the first in member order.
export const coalesceValue = (values: Record<string, string>, memberKeys: string[]): string => {
  for (const key of memberKeys) {
    const value = values[key];
    if (value !== undefined && value !== "") return value;
  }
  return "";
};
