// An uploaded HR spreadsheet, stored in the structure it arrived in — original
// headers preserved, each row as a key/value map — with a separately-editable
// column mapping that records which headers carry which canonical field.

export type HrSourceFormat = "csv" | "xlsx";
export type HrDatasetStatus = "active" | "archived";

// The canonical fields resolution reads through the mapping for.
export type HrFieldKind = "email" | "name" | "manager" | "position" | "band" | "unit";

// Maps an original spreadsheet header to the canonical field it carries. Stored
// header-keyed so a file with extra columns keeps them all; resolution inverts
// as needed.
export type HrColumnMapping = Record<string, HrFieldKind>;

export interface HrDataset {
  readonly id: string;
  readonly filename: string;
  readonly sourceFormat: HrSourceFormat;
  readonly uploadedByUserId: string;
  readonly columns: string[];
  readonly columnMapping: HrColumnMapping;
  readonly rowCount: number;
  readonly status: HrDatasetStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewHrDataset {
  filename: string;
  sourceFormat: HrSourceFormat;
  uploadedByUserId: string;
  columns: string[];
  columnMapping?: HrColumnMapping;
  rowCount: number;
  status?: HrDatasetStatus;
}

export interface HrRow {
  readonly id: string;
  readonly datasetId: string;
  readonly rowIndex: number;
  readonly data: Record<string, string>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewHrRow {
  datasetId: string;
  rowIndex: number;
  data: Record<string, string>;
}
