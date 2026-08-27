"use client";

import type { ConfidenceBand, ExtractionFieldReportRow } from "@rbrasier/domain";
import { reportBandSource } from "./field-provenance-display";
import { trpc } from "@/trpc/client";
import { RUN_POLL_INTERVAL_MS } from "./run-progress";

// The per-run field report (phase §5): per-record rows × extraction-field columns
// — the extraction analogue of the Insights field report. Read-only; the editable
// triage lives in the results grid above it.
export interface RunReportProps {
  runId: string;
  // Set while the run can still gain records, so the report follows the grid
  // above it instead of holding the shape it had when the screen opened.
  live?: boolean;
}

const BAND_DOT: Record<ConfidenceBand, string> = {
  red: "bg-[#d1493f]",
  amber: "bg-[#d99a2b]",
  green: "bg-[#2f9e6b]",
};

// One dot per row, so it reports the scale that carries the review risk. A
// record with no fields has no band to report — nothing is drawn rather than a
// red dot claiming the record is untrustworthy.
function RecordBandDot({ aggregate }: { aggregate: ExtractionFieldReportRow["aggregateConfidence"] }) {
  const source = reportBandSource(aggregate);
  if (!source) return null;
  return (
    <span
      title={`Lowest ${source.kind} confidence on this record`}
      className={`inline-block h-[9px] w-[9px] rounded-full ${BAND_DOT[source.band]}`}
    />
  );
}

export function RunReport({ runId, live = false }: RunReportProps) {
  const reportQuery = trpc.extraction.runReport.useQuery(
    { runId },
    { refetchInterval: live ? RUN_POLL_INTERVAL_MS : false },
  );

  if (reportQuery.isLoading || reportQuery.error) return null;
  const report = reportQuery.data?.report;
  if (!report || report.rows.length === 0) return null;

  return (
    <section className="flex flex-col gap-[8px]">
      <h2 className="text-[12px] font-semibold uppercase tracking-[0.05em] text-[#666055]">
        Field report
      </h2>
      <div className="overflow-x-auto rounded-[10px] border border-[#e7e3db] bg-white">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-[#e7e3db] text-left text-[11px] uppercase tracking-[0.05em] text-[#666055]">
              <th scope="col" className="px-[12px] py-[8px]">Record</th>
              {report.columns.map((column) => (
                <th key={column.fieldKey} scope="col" className="px-[12px] py-[8px]">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => (
              <tr key={row.recordId} className="border-b border-[#f5f3ee]">
                <td className="px-[12px] py-[8px] font-medium text-[#3d382f]">
                  <span className="flex items-center gap-[6px]">
                    <RecordBandDot aggregate={row.aggregateConfidence} />
                    {row.label}
                  </span>
                </td>
                {report.columns.map((column) => (
                  <td key={column.fieldKey} className="px-[12px] py-[8px] text-[#5c574c]">
                    {row.values[column.fieldKey] || <span className="text-[#c9c3b5]">—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
