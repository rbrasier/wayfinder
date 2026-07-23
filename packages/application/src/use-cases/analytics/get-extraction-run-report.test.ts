import { describe, expect, it, vi } from "vitest";
import {
  ok,
  type ExtractionRecord,
  type ExtractionRun,
  type ExtractionSchema,
  type FlowVersion,
  type Result,
} from "@rbrasier/domain";
import { GetExtractionRunReport } from "./get-extraction-run-report";

const run: ExtractionRun = {
  id: "run-1",
  flowId: "flow-1",
  flowVersionId: "version-1",
  initiatedByUserId: "user-1",
  mode: "full",
  status: "complete",
  previewBoundary: 0,
  totalCount: 1,
  doneCount: 1,
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
  output: { format: "docx", outputTemplate: null, instruction: "", generateSummary: false, summaryTemplate: null, contextDocs: [] },
};

const records: ExtractionRecord[] = [
  {
    id: "rec-1",
    label: "Acme",
    fields: [
      { key: "supplier", value: "Acme Ltd", confidence: 0.9, rationale: "" },
      { key: "price", value: "£10", confidence: 0.3, rationale: "" },
    ],
    sourceDocumentIds: [],
  },
];

describe("GetExtractionRunReport", () => {
  const buildDeps = () => {
    const runs = {
      getRun: vi.fn(async (): Promise<Result<ExtractionRun>> => ok(run)),
      listRecords: vi.fn(async (): Promise<Result<ExtractionRecord[]>> => ok(records)),
    };
    const flowVersions = {
      getById: vi.fn(async (): Promise<Result<FlowVersion | null>> =>
        ok({ id: "version-1", snapshot: { kind: "extraction", metadata: {}, nodes: [], edges: [], extraction: schema } } as unknown as FlowVersion),
      ),
    };
    return { runs, flowVersions, useCase: new GetExtractionRunReport(runs as never, flowVersions as never) };
  };

  it("returns a field report keyed on records, reusing the Insights column/row shape", async () => {
    const deps = buildDeps();
    const result = await deps.useCase.execute({ runId: "run-1" });

    expect(result.error).toBeUndefined();
    expect(result.data!.run.id).toBe("run-1");
    expect(result.data!.report.columns.map((column) => column.fieldKey)).toEqual(["supplier", "price"]);
    expect(result.data!.report.rows[0]).toMatchObject({
      recordId: "rec-1",
      values: { supplier: "Acme Ltd", price: "£10" },
      aggregateConfidence: 0.3,
    });
  });
});
