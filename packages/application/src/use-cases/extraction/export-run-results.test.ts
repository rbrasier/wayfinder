import { describe, expect, it, vi } from "vitest";
import {
  domainError,
  err,
  ok,
  type ExtractionRecord,
  type ExtractionRun,
  type ExtractionSchema,
  type FlowVersion,
  type Result,
  type CsvTable,
  type WriteSpreadsheetInput,
} from "@rbrasier/domain";
import { ExportRunResults } from "./export-run-results";

const run: ExtractionRun = {
  id: "run-1",
  flowId: "flow-1",
  flowVersionId: "version-1",
  initiatedByUserId: "user-1",
  mode: "full",
  status: "complete",
  previewBoundary: 0,
  totalCount: 2,
  doneCount: 2,
  failedCount: 0,
  unreadableCount: 0,
  costUsd: 0,
};

const schema: ExtractionSchema = {
  fields: [
    { field: { key: "supplier", label: "Supplier", type: "text", optional: false, raw: "" }, instruction: "", doneWhen: null },
    { field: { key: "price", label: "Price", type: "currency", optional: false, raw: "" }, instruction: "", doneWhen: null },
  ],
  input: { cardinality: "one_per_file", selectionCriteria: null, guidance: "" },
  output: {
    format: "docx",
    outputTemplate: null,
    instruction: "",
    generateSummary: false,
    summaryTemplate: null,
    contextDocs: [],
  },
};

const records: ExtractionRecord[] = [
  {
    id: "rec-1",
    label: "Acme",
    fields: [
      { key: "supplier", value: "Acme Ltd", confidence: 0.9, rationale: "cover page" },
      { key: "price", value: "£10", confidence: 0.4, rationale: "guessed" },
    ],
    sourceDocumentIds: ["doc-1"],
  },
];

const buildDeps = () => {
  const stored: Array<{ key: string; data: Buffer; mime: string }> = [];
  const runs = {
    getRun: vi.fn(async (): Promise<Result<ExtractionRun>> => ok(run)),
    listRecords: vi.fn(async (): Promise<Result<ExtractionRecord[]>> => ok(records)),
  };
  const flowVersions = {
    getById: vi.fn(async (): Promise<Result<FlowVersion | null>> =>
      ok({
        id: "version-1",
        flowId: "flow-1",
        versionNumber: 1,
        status: "published",
        snapshot: { kind: "extraction", metadata: {}, nodes: [], edges: [], extraction: schema },
        createdAt: new Date(),
      } as unknown as FlowVersion),
    ),
  };
  let lastWorkbook: WriteSpreadsheetInput | null = null;
  const spreadsheetWriter = {
    write: vi.fn((input: WriteSpreadsheetInput) => {
      lastWorkbook = input;
      return ok({ bytes: Buffer.from("xlsx-bytes") });
    }),
  };
  let lastCsvTable: CsvTable | null = null;
  const csvWriter = {
    write: vi.fn((input: CsvTable) => {
      lastCsvTable = input;
      return ok({ bytes: Buffer.from("csv-bytes") });
    }),
  };
  const storage = {
    put: vi.fn(async (key: string, data: Buffer, mime: string) => {
      stored.push({ key, data, mime });
      return ok({ key });
    }),
  };
  const auditLogger = { log: vi.fn(async () => ok(true as const)) };

  return {
    stored,
    runs,
    flowVersions,
    spreadsheetWriter,
    csvWriter,
    storage,
    auditLogger,
    getWorkbook: () => lastWorkbook!,
    getCsvTable: () => lastCsvTable!,
    useCase: new ExportRunResults(
      runs as never,
      flowVersions as never,
      spreadsheetWriter as never,
      csvWriter as never,
      storage as never,
      auditLogger as never,
    ),
  };
};

describe("ExportRunResults", () => {
  it("stores an XLSX, a JSON and a CSV artifact and returns their keys", async () => {
    const deps = buildDeps();
    const result = await deps.useCase.execute({ runId: "run-1", userId: "user-1" });

    expect(result.error).toBeUndefined();
    expect(result.data).toEqual({
      xlsxKey: "extraction-runs/run-1/exports/results.xlsx",
      jsonKey: "extraction-runs/run-1/exports/results.json",
      csvKey: "extraction-runs/run-1/exports/results.csv",
      recordCount: 1,
    });
    expect(deps.stored.map((entry) => entry.key).sort()).toEqual([
      "extraction-runs/run-1/exports/results.csv",
      "extraction-runs/run-1/exports/results.json",
      "extraction-runs/run-1/exports/results.xlsx",
    ]);
  });

  it("writes two tabs — extracted data first, confidence second", async () => {
    const deps = buildDeps();
    await deps.useCase.execute({ runId: "run-1", userId: "user-1" });

    expect(deps.getWorkbook().sheets.map((sheet) => sheet.name)).toEqual([
      "Extracted data",
      "Confidence",
    ]);
  });

  it("gives the data tab a column per field in schema order, values only", async () => {
    const deps = buildDeps();
    await deps.useCase.execute({ runId: "run-1", userId: "user-1" });

    const dataTab = deps.getWorkbook().sheets[0]!;
    expect(dataTab.columns.map((column) => column.key)).toEqual(["record", "supplier", "price"]);
    expect(dataTab.rows).toEqual([{ record: "Acme", supplier: "Acme Ltd", price: "£10" }]);
  });

  it("keeps confidence and rationale out of the data tab", async () => {
    const deps = buildDeps();
    await deps.useCase.execute({ runId: "run-1", userId: "user-1" });

    const dataTab = deps.getWorkbook().sheets[0]!;
    const keys = dataTab.columns.map((column) => column.key);
    expect(keys.some((key) => key.includes("confidence"))).toBe(false);
    expect(keys.some((key) => key.includes("rationale"))).toBe(false);
  });

  it("gives the confidence tab one row per record and field, with band and rationale", async () => {
    const deps = buildDeps();
    await deps.useCase.execute({ runId: "run-1", userId: "user-1" });

    const confidenceTab = deps.getWorkbook().sheets[1]!;
    expect(confidenceTab.columns.map((column) => column.key)).toEqual([
      "record",
      "field",
      "value",
      "confidence",
      "band",
      "rationale",
    ]);
    expect(confidenceTab.rows).toEqual([
      {
        record: "Acme",
        field: "Supplier",
        value: "Acme Ltd",
        confidence: "90",
        band: "green",
        rationale: "cover page",
      },
      {
        record: "Acme",
        field: "Price",
        value: "£10",
        confidence: "40",
        band: "red",
        rationale: "guessed",
      },
    ]);
  });

  it("writes a blank data cell and a zero-confidence row for a field the record is missing", async () => {
    const deps = buildDeps();
    deps.runs.listRecords.mockResolvedValueOnce(
      ok([{ ...records[0]!, fields: [records[0]!.fields[0]!] }]),
    );
    await deps.useCase.execute({ runId: "run-1", userId: "user-1" });

    const workbook = deps.getWorkbook();
    expect(workbook.sheets[0]!.rows[0]).toMatchObject({ price: "" });
    expect(workbook.sheets[1]!.rows).toHaveLength(2);
    expect(workbook.sheets[1]!.rows[1]).toMatchObject({ field: "Price", value: "", confidence: "0" });
  });

  it("writes the full records (with rationale + sources) into the JSON artifact", async () => {
    const deps = buildDeps();
    await deps.useCase.execute({ runId: "run-1", userId: "user-1" });

    const jsonEntry = deps.stored.find((entry) => entry.key.endsWith(".json"))!;
    const payload = JSON.parse(jsonEntry.data.toString("utf8"));
    expect(payload.records[0].fields[0]).toEqual({
      key: "supplier",
      value: "Acme Ltd",
      confidence: 0.9,
      rationale: "cover page",
    });
    expect(payload.records[0].sourceDocumentIds).toEqual(["doc-1"]);
  });

  it("writes an audit event for the export", async () => {
    const deps = buildDeps();
    await deps.useCase.execute({ runId: "run-1", userId: "user-1" });

    expect(deps.auditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "user-1",
        action: "extraction_run.exported",
        resourceType: "extraction_run",
        resourceId: "run-1",
      }),
    );
  });
  it("writes the CSV to the run's export key with a text/csv content type", async () => {
    const deps = buildDeps();
    await deps.useCase.execute({ runId: "run-1", userId: "user-1" });

    const csvEntry = deps.stored.find((entry) => entry.key.endsWith(".csv"))!;
    expect(csvEntry.key).toBe("extraction-runs/run-1/exports/results.csv");
    expect(csvEntry.mime).toBe("text/csv");
    expect(csvEntry.data.toString("utf8")).toBe("csv-bytes");
  });

  it("hands the CSV writer the data sheet's columns and rows, not the confidence sheet's", async () => {
    const deps = buildDeps();
    await deps.useCase.execute({ runId: "run-1", userId: "user-1" });

    const dataTab = deps.getWorkbook().sheets[0]!;
    expect(deps.getCsvTable().columns).toEqual(dataTab.columns);
    expect(deps.getCsvTable().rows).toEqual(dataTab.rows);
  });

  it("keeps confidence and rationale out of the CSV", async () => {
    const deps = buildDeps();
    await deps.useCase.execute({ runId: "run-1", userId: "user-1" });

    const keys = deps.getCsvTable().columns.map((column) => column.key);
    expect(keys).toEqual(["record", "supplier", "price"]);
    expect(keys.some((key) => key.includes("confidence"))).toBe(false);
    expect(keys.some((key) => key.includes("rationale"))).toBe(false);
  });

  it("names CSV in the audit event's formats", async () => {
    const deps = buildDeps();
    await deps.useCase.execute({ runId: "run-1", userId: "user-1" });

    expect(deps.auditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ formats: ["xlsx", "json", "csv"] }),
      }),
    );
  });

  // One number across three formats would be ambiguous, so volume is recorded
  // per format — an auditor asking "how much left as CSV" gets an answer.
  it("records byte volume per format in the audit event", async () => {
    const deps = buildDeps();
    await deps.useCase.execute({ runId: "run-1", userId: "user-1" });

    const entry = deps.auditLogger.log.mock.calls[0]![0] as {
      metadata: { bytes: Record<string, number>; recordCount: number };
    };
    const stored = new Map(deps.stored.map((item) => [item.key.split(".").pop()!, item.data.length]));
    expect(entry.metadata.bytes).toEqual({
      xlsx: stored.get("xlsx"),
      json: stored.get("json"),
      csv: stored.get("csv"),
    });
    expect(entry.metadata.recordCount).toBe(1);
  });

  it("returns a DomainError and announces no export when the CSV writer fails", async () => {
    const deps = buildDeps();
    deps.csvWriter.write.mockReturnValueOnce(
      err(domainError("INFRA_FAILURE", "Failed to write the CSV export.")),
    );

    const result = await deps.useCase.execute({ runId: "run-1", userId: "user-1" });

    expect(result.data).toBeUndefined();
    expect(result.error?.code).toBe("INFRA_FAILURE");
    expect(deps.stored).toEqual([]);
    expect(deps.auditLogger.log).not.toHaveBeenCalled();
  });

  it("returns a DomainError and announces no export when storing the CSV fails", async () => {
    const deps = buildDeps();
    deps.storage.put.mockImplementationOnce(async (key: string, data: Buffer, mime: string) => {
      deps.stored.push({ key, data, mime });
      return ok({ key });
    });
    deps.storage.put.mockImplementationOnce(async (key: string, data: Buffer, mime: string) => {
      deps.stored.push({ key, data, mime });
      return ok({ key });
    });
    deps.storage.put.mockResolvedValueOnce(err(domainError("INFRA_FAILURE", "Storage is unavailable.")));

    const result = await deps.useCase.execute({ runId: "run-1", userId: "user-1" });

    expect(result.data).toBeUndefined();
    expect(result.error?.code).toBe("INFRA_FAILURE");
    expect(deps.auditLogger.log).not.toHaveBeenCalled();
  });
});
