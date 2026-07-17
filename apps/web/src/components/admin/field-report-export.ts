import { coalesceValue, typedDisplayCell } from "@rbrasier/domain";
import type { FieldReportSessionRow, TemplateFieldType } from "@rbrasier/domain";

// A displayed column reduced to what the export needs: its heading, its field
// type (for numeric-vs-text cells) and the raw member keys it coalesces.
export interface ExportColumn {
  label: string;
  type: TemplateFieldType;
  memberKeys: string[];
}

// A `write-excel-file` cell. The `type` is the native constructor the library
// uses to decide the Excel cell type; `null` writes a blank cell.
type SheetCell =
  | { value: string; type: StringConstructor; fontWeight?: "bold" }
  | { value: number; type: NumberConstructor }
  | null;

const STATUS_LABELS: Record<string, string> = {
  complete: "Complete",
  abandoned: "Abandoned",
};

const statusLabel = (status: string): string => STATUS_LABELS[status] ?? "In progress";

const isoDate = (date: Date): string => new Date(date).toISOString().slice(0, 10);

const headerCell = (label: string): SheetCell => ({ value: label, fontWeight: "bold", type: String });

const valueCell = (column: ExportColumn, row: FieldReportSessionRow): SheetCell => {
  const cell = typedDisplayCell(column.type, coalesceValue(row.values, column.memberKeys));
  if (cell.value === "") return null;
  if (cell.isNumeric) return { value: cell.value as number, type: Number };
  return { value: cell.value as string, type: String };
};

// Serialises the on-screen field report into `write-excel-file` sheet rows:
// a bold header, then Started + Status + one typed cell per displayed column.
// Pure so the mapping can be unit-tested without loading the xlsx writer.
export const buildInsightsSheetData = (
  columns: ExportColumn[],
  rows: FieldReportSessionRow[],
): SheetCell[][] => {
  const header: SheetCell[] = [
    headerCell("Started"),
    headerCell("Status"),
    ...columns.map((column) => headerCell(column.label)),
  ];

  const body = rows.map((row): SheetCell[] => [
    { value: isoDate(row.startedAt), type: String },
    { value: statusLabel(row.status), type: String },
    ...columns.map((column) => valueCell(column, row)),
  ]);

  return [header, ...body];
};

export const insightsExportFileName = (flowName: string, date: Date): string => {
  const stem = flowName.trim().replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").replace(/-+/g, "-");
  return `${stem || "flow"}-insights-${isoDate(date)}.xlsx`;
};

// Builds the `.xlsx` in the browser and triggers the download. The writer is
// lazy-loaded so it stays out of the initial insights bundle.
export const exportInsightsXlsx = async (
  flowName: string,
  columns: ExportColumn[],
  rows: FieldReportSessionRow[],
): Promise<void> => {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const data = buildInsightsSheetData(columns, rows);
  await writeXlsxFile(data, { columns: columns.map(() => ({ width: 22 })) }).toFile(
    insightsExportFileName(flowName, new Date()),
  );
};
