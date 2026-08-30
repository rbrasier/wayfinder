import {
  confidenceBand,
  ok,
  type ExtractionField,
  type ExtractionRecord,
  type CsvTable,
  type IAuditLogger,
  type ICsvWriter,
  type IExtractionRunRepository,
  type IFlowVersionRepository,
  type IObjectStorage,
  type ISpreadsheetWriter,
  type Result,
  type SpreadsheetColumn,
  type SpreadsheetSheet,
} from "@rbrasier/domain";
import { loadExtractionSchemaForVersion } from "./run-schema";

export interface ExportRunResultsInput {
  runId: string;
  userId: string;
}

export interface ExportRunResultsOutput {
  xlsxKey: string;
  jsonKey: string;
  csvKey: string;
  recordCount: number;
}

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const exportKey = (runId: string, extension: string): string =>
  `extraction-runs/${runId}/exports/results.${extension}`;

const percent = (confidence: number): string => String(Math.round(confidence * 100));

// Writes the full records × fields set to XLSX, JSON and CSV in object storage
// (phase §2.2). The XLSX is the on-screen download and carries two tabs: the
// extracted values on their own (the sheet an operator pastes into a report) and
// the confidence/rationale metadata behind them. The JSON is the full-fidelity
// machine copy (rationale + source links). The CSV mirrors the data tab alone —
// the confidence tab is a second, differently-shaped table CSV cannot represent
// (ADR-054). All three overwrite the run's single export slot, so the latest
// export is always the download target.
export class ExportRunResults {
  constructor(
    private readonly runs: IExtractionRunRepository,
    private readonly flowVersions: IFlowVersionRepository,
    private readonly spreadsheetWriter: ISpreadsheetWriter,
    private readonly csvWriter: ICsvWriter,
    private readonly storage: IObjectStorage,
    private readonly auditLogger: IAuditLogger,
  ) {}

  async execute(input: ExportRunResultsInput): Promise<Result<ExportRunResultsOutput>> {
    const run = await this.runs.getRun(input.runId);
    if (run.error) return run;

    const schema = await loadExtractionSchemaForVersion(this.flowVersions, run.data.flowVersionId);
    if (schema.error) return schema;

    const recordsResult = await this.runs.listRecords(input.runId);
    if (recordsResult.error) return recordsResult;
    const records = recordsResult.data;

    const dataSheet = this.dataSheet(schema.data.fields, records);
    const workbook = this.spreadsheetWriter.write({
      sheets: [dataSheet, this.confidenceSheet(schema.data.fields, records)],
    });
    if (workbook.error) return workbook;

    // The CSV is written before anything is stored, so a writer failure leaves
    // the run's previous export untouched rather than half-replaced.
    const csv = this.csvWriter.write(this.dataTable(dataSheet));
    if (csv.error) return csv;

    const xlsxKey = exportKey(input.runId, "xlsx");
    const storeXlsx = await this.storage.put(xlsxKey, workbook.data.bytes, XLSX_MIME);
    if (storeXlsx.error) return storeXlsx;

    const jsonKey = exportKey(input.runId, "json");
    const json = Buffer.from(
      JSON.stringify({ runId: input.runId, fields: this.jsonFields(schema.data.fields), records }, null, 2),
      "utf8",
    );
    const storeJson = await this.storage.put(jsonKey, json, "application/json");
    if (storeJson.error) return storeJson;

    const csvKey = exportKey(input.runId, "csv");
    const storeCsv = await this.storage.put(csvKey, csv.data.bytes, "text/csv");
    if (storeCsv.error) return storeCsv;

    await this.auditLogger.log({
      actorId: input.userId,
      action: "extraction_run.exported",
      resourceType: "extraction_run",
      resourceId: input.runId,
      metadata: {
        recordCount: records.length,
        formats: ["xlsx", "json", "csv"],
        // Per format rather than one total: an auditor asking how much data left
        // as CSV cannot answer it from a combined number.
        bytes: {
          xlsx: workbook.data.bytes.length,
          json: json.length,
          csv: csv.data.bytes.length,
        },
      },
    });

    return ok({ xlsxKey, jsonKey, csvKey, recordCount: records.length });
  }

  // The CSV carries the data tab exactly as the workbook does, so the two
  // downloads of the same run never disagree about columns or row order.
  private dataTable(sheet: SpreadsheetSheet): CsvTable {
    return { columns: sheet.columns, rows: sheet.rows };
  }

  // Tab 1: the extracted values and nothing else, so the sheet can be pasted
  // into a report without deleting interleaved metadata columns.
  private dataSheet(fields: ExtractionField[], records: ExtractionRecord[]): SpreadsheetSheet {
    const columns: SpreadsheetColumn[] = [{ key: "record", label: "Record" }];
    for (const field of fields) {
      columns.push({ key: field.field.key, label: field.field.label });
    }

    const rows = records.map((record) => {
      const byKey = new Map(record.fields.map((field) => [field.key, field]));
      const values: Record<string, string> = { record: record.label };
      for (const field of fields) {
        values[field.field.key] = byKey.get(field.field.key)?.value ?? "";
      }
      return values;
    });

    return { name: "Extracted data", columns, rows };
  }

  // Tab 2: the confidence metadata, one row per record × field. Long form rather
  // than mirroring tab 1's width because rationale is a sentence or two per cell.
  // The band is written alongside the percentage so the sheet can be filtered
  // without re-deriving the thresholds in Excel.
  private confidenceSheet(fields: ExtractionField[], records: ExtractionRecord[]): SpreadsheetSheet {
    const columns: SpreadsheetColumn[] = [
      { key: "record", label: "Record" },
      { key: "field", label: "Field" },
      { key: "value", label: "Value" },
      { key: "confidence", label: "Confidence %" },
      { key: "band", label: "Band" },
      { key: "rationale", label: "Rationale" },
    ];

    const rows: Array<Record<string, string>> = [];
    for (const record of records) {
      const byKey = new Map(record.fields.map((field) => [field.key, field]));
      for (const field of fields) {
        const result = byKey.get(field.field.key);
        const confidence = result?.confidence ?? 0;
        rows.push({
          record: record.label,
          field: field.field.label,
          value: result?.value ?? "",
          confidence: percent(confidence),
          band: confidenceBand(confidence),
          rationale: result?.rationale ?? "",
        });
      }
    }

    return { name: "Confidence", columns, rows };
  }

  private jsonFields(fields: ExtractionField[]): Array<{ key: string; label: string }> {
    return fields.map((field) => ({ key: field.field.key, label: field.field.label }));
  }
}
