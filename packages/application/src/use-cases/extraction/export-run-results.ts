import {
  confidenceBand,
  fieldConfidence,
  ok,
  type ExtractionField,
  type ExtractionFieldResult,
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

// Provenance metadata is written as one companion column per field, suffixed so
// it can never collide with a schema field key of the same name.
const PROVENANCE_SUFFIX = "__provenance";
const DERIVATION_SUFFIX = "__derivation";
const SOURCE_SUFFIX = "__source";

const describeDerivation = (result: ExtractionFieldResult | undefined): string => {
  if (!result?.derivation) return "";
  const { method, sourceKeys } = result.derivation;
  return sourceKeys.length > 0 ? `${method} (from ${sourceKeys.join(", ")})` : method;
};

// The stored reference addresses a document by id, which is what makes it
// followable in the product; an export is read outside it, so the id is resolved
// to the filename the reader recognises. An id with no matching document falls
// back to the id rather than dropping the locator — a reference to a document
// since removed is still evidence.
const describeSourceRef = (
  result: ExtractionFieldResult | undefined,
  filenamesByDocumentId: Map<string, string>,
): string => {
  if (!result?.sourceRef) return "";
  const { documentId, locator } = result.sourceRef;
  return `${filenamesByDocumentId.get(documentId) ?? documentId} — ${locator}`;
};

// Writes the full records × fields set to XLSX, JSON and CSV in object storage
// (phase §2.2). The XLSX is the on-screen download and carries two tabs: the
// extracted values on their own (the sheet an operator pastes into a report) and
// the confidence/rationale metadata behind them. The JSON is the full-fidelity
// machine copy (rationale + source links). The CSV mirrors the data tab alone —
// the confidence tab is a second, differently-shaped table CSV cannot represent
// (ADR-054), plus the provenance columns the workbook keeps on that second tab —
// as the single-table format it has nowhere else to put them (ADR-053). All
// three overwrite the run's single export slot, so the latest export is always
// the download target.
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

    // Source references address documents by id; an export is read outside the
    // product, so the ids are resolved to filenames. A document listing failure
    // is not an export failure — the references fall back to their ids.
    const documents = await this.runs.listDocuments(input.runId);
    const filenamesByDocumentId = new Map(
      (documents.error ? [] : documents.data).map((document) => [document.id, document.filename]),
    );

    const dataSheet = this.dataSheet(schema.data.fields, records);
    const workbook = this.spreadsheetWriter.write({
      sheets: [dataSheet, this.confidenceSheet(schema.data.fields, records, filenamesByDocumentId)],
    });
    if (workbook.error) return workbook;

    // The CSV is written before anything is stored, so a writer failure leaves
    // the run's previous export untouched rather than half-replaced.
    const csv = this.csvWriter.write(
      this.dataTable(dataSheet, schema.data.fields, records, filenamesByDocumentId),
    );
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

  // The CSV opens with the data tab exactly as the workbook writes it, so the two
  // downloads of the same run never disagree about values or row order, then
  // appends the provenance the workbook carries on its confidence tab. A
  // derivation or source column is written only where some record actually
  // recorded one, so a run with no derived fields is not padded with empty
  // columns — the same data still exports byte-identically every time.
  private dataTable(
    sheet: SpreadsheetSheet,
    fields: ExtractionField[],
    records: ExtractionRecord[],
    filenamesByDocumentId: Map<string, string>,
  ): CsvTable {
    const columns: SpreadsheetColumn[] = [...sheet.columns];
    const resultsByKey = records.map((record) => new Map(record.fields.map((field) => [field.key, field])));

    const has = (key: string, predicate: (result: ExtractionFieldResult) => boolean): boolean =>
      resultsByKey.some((byKey) => {
        const result = byKey.get(key);
        return result !== undefined && predicate(result);
      });

    const derived: string[] = [];
    const sourced: string[] = [];
    for (const field of fields) {
      const key = field.field.key;
      columns.push({ key: `${key}${PROVENANCE_SUFFIX}`, label: `${field.field.label} — provenance` });
      if (has(key, (result) => result.derivation !== undefined)) derived.push(key);
      if (has(key, (result) => result.sourceRef !== undefined)) sourced.push(key);
    }
    for (const key of derived) {
      const label = fields.find((field) => field.field.key === key)!.field.label;
      columns.push({ key: `${key}${DERIVATION_SUFFIX}`, label: `${label} — derivation` });
    }
    for (const key of sourced) {
      const label = fields.find((field) => field.field.key === key)!.field.label;
      columns.push({ key: `${key}${SOURCE_SUFFIX}`, label: `${label} — source` });
    }

    const rows = sheet.rows.map((row, index) => {
      const byKey = resultsByKey[index]!;
      const values: Record<string, string> = { ...row };
      for (const field of fields) {
        const key = field.field.key;
        const result = byKey.get(key);
        values[`${key}${PROVENANCE_SUFFIX}`] = result ? fieldConfidence(result).provenance : "";
      }
      for (const key of derived) values[`${key}${DERIVATION_SUFFIX}`] = describeDerivation(byKey.get(key));
      for (const key of sourced) {
        values[`${key}${SOURCE_SUFFIX}`] = describeSourceRef(byKey.get(key), filenamesByDocumentId);
      }
      return values;
    });

    return { columns, rows };
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

  // Tab 2: the confidence and provenance metadata, one row per record × field.
  // Long form rather than mirroring tab 1's width because rationale is a
  // sentence or two per cell. The band is written alongside the percentage so the
  // sheet can be filtered without re-deriving the thresholds in Excel, and the
  // kind beside it so a reader knows which question the percentage answers.
  private confidenceSheet(
    fields: ExtractionField[],
    records: ExtractionRecord[],
    filenamesByDocumentId: Map<string, string>,
  ): SpreadsheetSheet {
    const columns: SpreadsheetColumn[] = [
      { key: "record", label: "Record" },
      { key: "field", label: "Field" },
      { key: "value", label: "Value" },
      { key: "confidence", label: "Confidence %" },
      { key: "kind", label: "Confidence of" },
      { key: "band", label: "Band" },
      { key: "provenance", label: "Provenance" },
      { key: "derivation", label: "Derivation" },
      { key: "source", label: "Source reference" },
      { key: "rationale", label: "Rationale" },
    ];

    const rows: Array<Record<string, string>> = [];
    for (const record of records) {
      const byKey = new Map(record.fields.map((field) => [field.key, field]));
      for (const field of fields) {
        const result = byKey.get(field.field.key);
        const confidence = result?.confidence ?? 0;
        // A field the record never carried has no provenance to report — an
        // empty cell, not a claim that the absent value was composed.
        const read = result ? fieldConfidence(result) : null;
        rows.push({
          record: record.label,
          field: field.field.label,
          value: result?.value ?? "",
          confidence: percent(confidence),
          kind: read?.kind ?? "",
          band: confidenceBand(confidence),
          provenance: read?.provenance ?? "",
          derivation: describeDerivation(result),
          source: describeSourceRef(result, filenamesByDocumentId),
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
