import {
  computeExtractionFieldReport,
  ok,
  type ExtractionFieldReport,
  type ExtractionRun,
  type IExtractionRunRepository,
  type IFlowVersionRepository,
  type Result,
} from "@rbrasier/domain";
import { loadExtractionSchemaForVersion } from "../extraction/run-schema";

export interface GetExtractionRunReportInput {
  runId: string;
}

export interface ExtractionRunReport {
  run: ExtractionRun;
  report: ExtractionFieldReport;
}

// The per-run field report (phase §5): per-record rows × extraction-field
// columns — the same structure computeFieldReport gives guided flows, so runs sit
// alongside guided-flow Insight rather than being forced into session dashboards.
export class GetExtractionRunReport {
  constructor(
    private readonly runs: IExtractionRunRepository,
    private readonly flowVersions: IFlowVersionRepository,
  ) {}

  async execute(input: GetExtractionRunReportInput): Promise<Result<ExtractionRunReport>> {
    const run = await this.runs.getRun(input.runId);
    if (run.error) return run;

    const schema = await loadExtractionSchemaForVersion(this.flowVersions, run.data.flowVersionId);
    if (schema.error) return schema;

    const records = await this.runs.listRecords(input.runId);
    if (records.error) return records;

    const report = computeExtractionFieldReport(
      schema.data.fields.map((field) => ({
        key: field.field.key,
        label: field.field.label,
        type: field.field.type,
      })),
      records.data,
    );

    return ok({ run: run.data, report });
  }
}
