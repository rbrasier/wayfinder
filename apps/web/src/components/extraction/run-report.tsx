"use client";

import { confidenceBand, type ConfidenceBand } from "@rbrasier/domain";
import { trpc } from "@/trpc/client";

// The per-run field report (phase §5): per-record rows × extraction-field columns
// — the extraction analogue of the Insights field report. Read-only; the editable
// triage lives in the results grid above it.
export interface RunReportProps {
  runId: string;
}

const BAND_DOT: Record<ConfidenceBand, string> = {
  red: "bg-[#d1493f]",
  amber: "bg-[#d99a2b]",
  green: "bg-[#2f9e6b]",
};

export function RunReport({ runId }: RunReportProps) {
  const reportQuery = trpc.extraction.runReport.useQuery({ runId });

  if (reportQuery.isLoading || reportQuery.error) return null;
  const report = reportQuery.data?.report;
  if (!report || report.rows.length === 0) return null;

  return (
    <section className="flex flex-col gap-[8px]">
      <h2 className="text-[12px] font-semibold uppercase tracking-[0.05em] text-[#6d6a65]">
        Field report
      </h2>
      <div className="overflow-x-auto rounded-[10px] border border-[#e5e1d8] bg-white">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-[#e5e1d8] text-left text-[11px] uppercase tracking-[0.05em] text-[#6d6a65]">
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
              <tr key={row.recordId} className="border-b border-[#f0ede7]">
                <td className="px-[12px] py-[8px] font-medium text-[#3a352e]">
                  <span className="flex items-center gap-[6px]">
                    <span
                      className={`inline-block h-[9px] w-[9px] rounded-full ${BAND_DOT[confidenceBand(row.aggregateConfidence)]}`}
                    />
                    {row.label}
                  </span>
                </td>
                {report.columns.map((column) => (
                  <td key={column.fieldKey} className="px-[12px] py-[8px] text-[#5a5650]">
                    {row.values[column.fieldKey] || <span className="text-[#b6b1a8]">—</span>}
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
