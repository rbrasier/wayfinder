import {
  domainError,
  err,
  ok,
  type HrColumnMapping,
  type HrDataset,
  type HrSourceFormat,
  type IColumnMappingDetector,
  type IHrDatasetRepository,
  type ISpreadsheetParser,
  type Result,
} from "@rbrasier/domain";

export interface ImportHrDatasetInput {
  filename: string;
  format: HrSourceFormat;
  content: Uint8Array;
  uploadedByUserId: string;
  // When supplied the mapping is stored as-is; otherwise the optional detector
  // pre-fills it from the headers.
  columnMapping?: HrColumnMapping;
}

// Parses an uploaded CSV/XLSX and stores it in the structure it arrived in —
// headers preserved, each row as-is. No mapping is required to import; when none
// is supplied an optional detector pre-fills one for the operator to confirm, and
// a detection failure never fails the import.
export class ImportHrDataset {
  constructor(
    private readonly parser: ISpreadsheetParser,
    private readonly datasets: IHrDatasetRepository,
    private readonly detector?: IColumnMappingDetector,
  ) {}

  async execute(input: ImportHrDatasetInput): Promise<Result<HrDataset>> {
    const parsed = await this.parser.parse({ content: input.content, format: input.format });
    if (parsed.error) return parsed;
    if (parsed.data.columns.length === 0) {
      return err(domainError("VALIDATION_FAILED", "The uploaded file has no columns."));
    }

    const columnMapping = await this.resolveMapping(input, parsed.data.columns, parsed.data.rows);

    const created = await this.datasets.createDataset({
      filename: input.filename,
      sourceFormat: input.format,
      uploadedByUserId: input.uploadedByUserId,
      columns: parsed.data.columns,
      columnMapping,
      rowCount: parsed.data.rows.length,
    });
    if (created.error) return created;

    if (parsed.data.rows.length > 0) {
      const inserted = await this.datasets.insertRows(
        parsed.data.rows.map((data, index) => ({
          datasetId: created.data.id,
          rowIndex: index,
          data,
        })),
      );
      if (inserted.error) return inserted;
    }

    return ok(created.data);
  }

  private async resolveMapping(
    input: ImportHrDatasetInput,
    headers: string[],
    rows: Record<string, string>[],
  ): Promise<HrColumnMapping> {
    if (input.columnMapping) return input.columnMapping;
    if (!this.detector) return {};

    const detected = await this.detector.detect({ headers, sampleRows: rows.slice(0, 3) });
    if (detected.error) return {};
    return detected.data;
  }
}
