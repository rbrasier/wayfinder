import {
  domainError,
  err,
  ok,
  type HrDataset,
  type HrSourceFormat,
  type IHrDatasetRepository,
  type ISpreadsheetParser,
  type Result,
} from "@rbrasier/domain";

export interface ImportHrDatasetInput {
  filename: string;
  format: HrSourceFormat;
  content: Uint8Array;
  uploadedByUserId: string;
}

// Parses an uploaded CSV/XLSX and stores it in the structure it arrived in —
// headers preserved, each row as-is. No mapping is required to import; mapping is
// layered on later for resolution.
export class ImportHrDataset {
  constructor(
    private readonly parser: ISpreadsheetParser,
    private readonly datasets: IHrDatasetRepository,
  ) {}

  async execute(input: ImportHrDatasetInput): Promise<Result<HrDataset>> {
    const parsed = await this.parser.parse({ content: input.content, format: input.format });
    if (parsed.error) return parsed;
    if (parsed.data.columns.length === 0) {
      return err(domainError("VALIDATION_FAILED", "The uploaded file has no columns."));
    }

    const created = await this.datasets.createDataset({
      filename: input.filename,
      sourceFormat: input.format,
      uploadedByUserId: input.uploadedByUserId,
      columns: parsed.data.columns,
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
}
