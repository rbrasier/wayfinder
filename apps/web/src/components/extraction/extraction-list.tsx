"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

const RUNS_PER_PAGE = 20;

// A past run of an extraction flow. Runs are persisted in Phase 2; in Phase 1
// this is always empty, so every flow shows a "Not yet run" sub-row.
export interface ExtractionRunSummary {
  id: string;
  startedAt: string;
  status: string;
}

export interface ExtractionFlowRow {
  id: string;
  name: string;
  status: string;
  runs: ExtractionRunSummary[];
}

function FlowRow({ flow, editHref }: { flow: ExtractionFlowRow; editHref: string | null }) {
  const [showAll, setShowAll] = useState(false);
  const [page, setPage] = useState(0);

  const latestRun = flow.runs[0] ?? null;
  const olderRuns = flow.runs.slice(1);
  const pageCount = Math.ceil(olderRuns.length / RUNS_PER_PAGE);
  const pagedOlder = olderRuns.slice(page * RUNS_PER_PAGE, page * RUNS_PER_PAGE + RUNS_PER_PAGE);

  return (
    <div className="rounded-[11px] border border-[#e5e1d8] bg-white">
      <div className="flex items-center justify-between px-[16px] py-[12px]">
        <div>
          <h3 className="text-[14px] font-semibold text-[#1a1814]">{flow.name}</h3>
          <span
            className={`mt-[2px] inline-block rounded-[5px] px-[6px] py-[1px] text-[10.5px] font-semibold uppercase tracking-[0.04em] ${
              flow.status === "published"
                ? "bg-[#eaf6f0] text-[#247c53]"
                : "bg-[#f0ede7] text-[#6d6a65]"
            }`}
          >
            {flow.status}
          </span>
        </div>
        {editHref && (
          <Button asChild variant="outline" size="sm">
            <Link href={editHref}>Edit</Link>
          </Button>
        )}
      </div>

      {/* Sub-row 1 — most recent run (or "not yet run") */}
      <div className="border-t border-[#f0ede7] px-[16px] py-[8px] text-[13px] text-[#5a5650]">
        {latestRun ? (
          <span>
            Latest run — {new Date(latestRun.startedAt).toLocaleString()} ({latestRun.status})
          </span>
        ) : (
          <span className="text-[#8a857c]">Not yet run</span>
        )}
      </div>

      {/* Sub-row 2 — show more, when older runs exist */}
      {olderRuns.length > 0 && (
        <div className="border-t border-[#f0ede7] px-[16px] py-[8px] text-[13px]">
          <button
            type="button"
            className="text-[#3a5fd9] hover:underline"
            onClick={() => setShowAll((value) => !value)}
          >
            {showAll ? "Hide older runs" : `Show ${olderRuns.length} older run${olderRuns.length === 1 ? "" : "s"}`}
          </button>
          {showAll && (
            <div className="mt-[6px] flex flex-col gap-[4px]">
              {pagedOlder.map((run) => (
                <span key={run.id} className="text-[#5a5650]">
                  {new Date(run.startedAt).toLocaleString()} ({run.status})
                </span>
              ))}
              {pageCount > 1 && (
                <div className="mt-[4px] flex items-center gap-[8px] text-[12px]">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => setPage((value) => Math.max(0, value - 1))}
                  >
                    Previous
                  </Button>
                  <span className="text-[#8a857c]">
                    Page {page + 1} of {pageCount}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={page >= pageCount - 1}
                    onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}
                  >
                    Next
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ExtractionList({
  flows,
  editable,
}: {
  flows: ExtractionFlowRow[];
  editable: boolean;
}) {
  return (
    <div className="flex flex-col gap-[10px]">
      {flows.map((flow) => (
        <FlowRow
          key={flow.id}
          flow={flow}
          editHref={editable ? `/synthesise/${flow.id}/edit` : null}
        />
      ))}
    </div>
  );
}
