// The run screen's export formats, as a decision separate from the markup that
// renders it. One export use case writes all three artifacts; the format only
// selects which one the browser is then sent to.

export type ExportFormat = "xlsx" | "json" | "csv";

export interface ExportMenuEntry {
  format: ExportFormat;
  label: string;
}

// The artifact route segment serving each format. The route resolves it to a
// deterministic storage key, so a caller never supplies a storage path.
const ARTIFACT_BY_FORMAT: Record<ExportFormat, string> = {
  xlsx: "export-xlsx",
  json: "export-json",
  csv: "export-csv",
};

export const exportArtifact = (format: ExportFormat): string => ARTIFACT_BY_FORMAT[format];

// The secondary formats, in the order the overflow menu lists them. Excel is
// absent deliberately: it keeps the primary button beside the menu, and CSV
// joins JSON as a secondary format rather than taking a third button of its own.
export const EXPORT_MENU_FORMATS: ExportMenuEntry[] = [
  { format: "json", label: "Download JSON" },
  { format: "csv", label: "Download CSV" },
];

// Only the control the operator pressed reads as preparing. The others are
// disabled meanwhile — one use case writes all three artifacts — but saying
// "Preparing…" on all of them would claim three downloads are on the way.
export const exportLabel = (
  entry: ExportMenuEntry,
  downloading: ExportFormat | null,
): string => (downloading === entry.format ? "Preparing…" : entry.label);
