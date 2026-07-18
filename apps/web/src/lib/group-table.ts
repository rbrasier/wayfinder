export interface GroupTableColumn {
  key: string;
  label: string;
}

export interface GroupTable {
  columns: GroupTableColumn[];
  rows: string[][];
}

// The stored group items carry only sub-field keys (e.g. `contract_value`), not
// their template labels, so headers are humanised from the key: snake_case is
// split and each word capitalised.
export const humaniseKey = (key: string): string =>
  key
    .split(/[_\s]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

// Shapes a repeating group's items into a table: columns are the union of item
// keys in first-seen order; each row has one cell per column, blank where the
// item lacks that key. Pure and display-only.
export const buildGroupTable = (items: Array<Record<string, string>>): GroupTable => {
  const orderedKeys: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    for (const key of Object.keys(item)) {
      if (seen.has(key)) continue;
      seen.add(key);
      orderedKeys.push(key);
    }
  }

  const columns = orderedKeys.map((key) => ({ key, label: humaniseKey(key) }));
  const rows = items.map((item) => orderedKeys.map((key) => item[key] ?? ""));
  return { columns, rows };
};
