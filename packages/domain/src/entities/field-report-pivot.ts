import type { TemplateFieldType } from "./template-field";
import type { FieldReportSessionRow } from "./analytics";
import { coalesceValue, typedCellValue } from "./field-report-view";

// A display column as the pivot understands it: the key it is addressed by, the
// raw member keys whose values it coalesces, and its field type for coercion.
export interface PivotColumn {
  columnKey: string;
  label: string;
  type: TemplateFieldType;
  memberKeys: string[];
}

export type PivotMeasure =
  | { kind: "count" }
  | { kind: "sum" | "avg"; columnKey: string };

// `value` is the measure result (count, sum, or average). `sampleCount` is the
// number of rows that contributed a numeric value — the average denominator and
// the signal for graceful degradation when nothing numeric was found.
export interface PivotCell {
  value: number;
  sampleCount: number;
}

export interface PivotRow {
  key: string;
  cells: PivotCell[];
  total: PivotCell;
}

export interface PivotResult {
  primaryGroups: string[];
  secondaryGroups: string[] | null;
  rows: PivotRow[];
  columnTotals: PivotCell[];
  grandTotal: PivotCell;
  hasNumericData: boolean;
}

interface PivotOptions {
  columns: PivotColumn[];
  groupByKey: string;
  secondaryGroupByKey?: string;
  measure: PivotMeasure;
}

const groupValue = (
  row: FieldReportSessionRow,
  key: string,
  columnByKey: Map<string, PivotColumn>,
): string => {
  const memberKeys = columnByKey.get(key)?.memberKeys ?? [key];
  return coalesceValue(row.values, memberKeys);
};

const aggregate = (
  subset: FieldReportSessionRow[],
  measure: PivotMeasure,
  measureColumn: PivotColumn | undefined,
): PivotCell => {
  if (measure.kind === "count") return { value: subset.length, sampleCount: subset.length };

  const numbers: number[] = [];
  for (const row of subset) {
    if (!measureColumn) continue;
    const raw = coalesceValue(row.values, measureColumn.memberKeys);
    const typed = typedCellValue(measureColumn.type, raw);
    if (typeof typed === "number") numbers.push(typed);
  }

  const sum = numbers.reduce((total, value) => total + value, 0);
  if (measure.kind === "sum") return { value: sum, sampleCount: numbers.length };
  return { value: numbers.length === 0 ? 0 : sum / numbers.length, sampleCount: numbers.length };
};

// Distinct group values in first-appearance order (before ranking).
const distinctValues = (
  rows: FieldReportSessionRow[],
  key: string,
  columnByKey: Map<string, PivotColumn>,
): string[] => {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const row of rows) {
    const value = groupValue(row, key, columnByKey);
    if (seen.has(value)) continue;
    seen.add(value);
    order.push(value);
  }
  return order;
};

// Ranks group keys by descending measure total, breaking ties alphabetically so
// the pivot table and chart are deterministic.
const rankByTotal = (keys: string[], totalByKey: Map<string, PivotCell>): string[] =>
  [...keys].sort((first, second) => {
    const difference = (totalByKey.get(second)?.value ?? 0) - (totalByKey.get(first)?.value ?? 0);
    if (difference !== 0) return difference;
    if (first < second) return -1;
    if (first > second) return 1;
    return 0;
  });

export const computePivot = (
  rows: FieldReportSessionRow[],
  options: PivotOptions,
): PivotResult => {
  const { columns, groupByKey, secondaryGroupByKey, measure } = options;
  const columnByKey = new Map(columns.map((column) => [column.columnKey, column]));
  const measureColumn =
    measure.kind === "count" ? undefined : columnByKey.get(measure.columnKey);

  const grandTotal = aggregate(rows, measure, measureColumn);
  const hasNumericData = measure.kind === "count" ? rows.length > 0 : grandTotal.sampleCount > 0;

  const primaryTotals = new Map<string, PivotCell>();
  for (const key of distinctValues(rows, groupByKey, columnByKey)) {
    const subset = rows.filter((row) => groupValue(row, groupByKey, columnByKey) === key);
    primaryTotals.set(key, aggregate(subset, measure, measureColumn));
  }
  const primaryGroups = rankByTotal([...primaryTotals.keys()], primaryTotals);

  if (secondaryGroupByKey === undefined) {
    const pivotRows: PivotRow[] = primaryGroups.map((key) => {
      const total = primaryTotals.get(key)!;
      return { key, cells: [total], total };
    });
    return {
      primaryGroups,
      secondaryGroups: null,
      rows: pivotRows,
      columnTotals: [grandTotal],
      grandTotal,
      hasNumericData,
    };
  }

  const secondaryTotals = new Map<string, PivotCell>();
  for (const key of distinctValues(rows, secondaryGroupByKey, columnByKey)) {
    const subset = rows.filter((row) => groupValue(row, secondaryGroupByKey, columnByKey) === key);
    secondaryTotals.set(key, aggregate(subset, measure, measureColumn));
  }
  const secondaryGroups = rankByTotal([...secondaryTotals.keys()], secondaryTotals);

  const pivotRows: PivotRow[] = primaryGroups.map((primaryKey) => {
    const cells = secondaryGroups.map((secondaryKey) => {
      const subset = rows.filter(
        (row) =>
          groupValue(row, groupByKey, columnByKey) === primaryKey &&
          groupValue(row, secondaryGroupByKey, columnByKey) === secondaryKey,
      );
      return aggregate(subset, measure, measureColumn);
    });
    return { key: primaryKey, cells, total: primaryTotals.get(primaryKey)! };
  });

  return {
    primaryGroups,
    secondaryGroups,
    rows: pivotRows,
    columnTotals: secondaryGroups.map((key) => secondaryTotals.get(key)!),
    grandTotal,
    hasNumericData,
  };
};
