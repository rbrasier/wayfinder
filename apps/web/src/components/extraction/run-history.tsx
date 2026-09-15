"use client";

import Link from "next/link";
import { processedCount, type RunStatus } from "@wayfinder/domain";
import { trpc } from "@/trpc/client";

// The run-history view (phase §5): every run for a flow with status, counts, and
// cost, newest first. Also feeds the /synthesise list's run sub-rows.
export interface RunHistoryProps {
  flowId: string;
}

const STATUS_LABEL: Record<RunStatus, string> = {
  running: "Running",
  paused_preview: "Paused at preview",
  paused_cap: "Paused (cost cap)",
  complete: "Complete",
  partial: "Partial",
  cancelled: "Cancelled",
};

const STATUS_TONE: Record<RunStatus, string> = {
  running: "bg-[#eaeefb] text-[#2f56d3]",
  paused_preview: "bg-[#f6e9d8] text-[#8a5a1d]",
  paused_cap: "bg-[#f6e9d8] text-[#8a5a1d]",
  complete: "bg-[#e9f5ee] text-[#2f9e6b]",
  partial: "bg-[#f6e9d8] text-[#8a5a1d]",
  cancelled: "bg-[#f5f3ee] text-[#666055]",
};

export function RunHistory({ flowId }: RunHistoryProps) {
  const runsQuery = trpc.extraction.listRuns.useQuery({ flowId });

  if (runsQuery.isLoading) {
    return <p className="text-[13px] text-[#736d5f]">Loading runs…</p>;
  }
  if (runsQuery.error) {
    return <p className="text-[13px] text-[#b23b30]">{runsQuery.error.message}</p>;
  }

  const runs = runsQuery.data ?? [];
  if (runs.length === 0) {
    return <p className="text-[13px] text-[#736d5f]">Not yet run.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-[10px] border border-[#e7e3db] bg-white">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-[#e7e3db] text-left text-[11px] uppercase tracking-[0.05em] text-[#666055]">
            <th scope="col" className="px-[12px] py-[8px]">Status</th>
            <th scope="col" className="px-[12px] py-[8px]">Processed</th>
            <th scope="col" className="px-[12px] py-[8px]">Exceptions</th>
            <th scope="col" className="px-[12px] py-[8px]">Cost</th>
            <th scope="col" className="px-[12px] py-[8px]" />
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id} className="border-b border-[#f5f3ee]">
              <td className="px-[12px] py-[8px]">
                <span className={`inline-block rounded-[5px] px-[7px] py-[2px] text-[11px] font-semibold ${STATUS_TONE[run.status]}`}>
                  {STATUS_LABEL[run.status]}
                </span>
              </td>
              <td className="px-[12px] py-[8px] text-[#5c574c]">
                {processedCount(run)} of {run.totalCount}
              </td>
              <td className="px-[12px] py-[8px] text-[#5c574c]">
                {run.failedCount + run.unreadableCount}
              </td>
              <td className="px-[12px] py-[8px] text-[#5c574c]">${run.costUsd.toFixed(2)}</td>
              <td className="px-[12px] py-[8px] text-right">
                <Link
                  href={`/synthesise/${flowId}/runs/${run.id}`}
                  className="text-[12px] font-medium text-[#2f56d3] hover:underline"
                >
                  Open →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
