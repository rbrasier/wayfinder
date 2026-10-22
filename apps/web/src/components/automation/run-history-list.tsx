"use client";

import Link from "next/link";
import type { UnattendedRunStatus } from "@rbrasier/domain";
import { Button } from "@/components/ui/button";
import { runStatusLabel, runStatusTone, type RunStatusTone } from "./run-status";

export interface RunHistoryItem {
  sessionId: string;
  title: string | null;
  status: UnattendedRunStatus;
  currentStepName: string | null;
  error: string | null;
  startedAt: Date | string;
}

const TONE_CLASS: Record<RunStatusTone, string> = {
  danger: "bg-[#fdecec] text-[#b42318]",
  attention: "bg-[#fdf3e3] text-[#7a4b0c]",
  active: "bg-wf-primary-light text-wf-primary",
  neutral: "bg-[#f1efe9] text-[#5c574c]",
};

const formatWhen = (value: Date | string): string => new Date(value).toLocaleString();

// The runs a watch or webhook started, newest first (ADR-065 §7), with a retry
// on any that failed.
export function RunHistoryList({
  runs,
  onRetry,
  retryingSessionId,
}: {
  runs: RunHistoryItem[];
  onRetry: (sessionId: string) => void;
  retryingSessionId: string | null;
}) {
  if (runs.length === 0) {
    return <p className="text-[13px] text-[#736d5f]">No runs yet.</p>;
  }
  return (
    <ul className="divide-y divide-[#eceae4] rounded-[9px] border border-[#e7e3db]">
      {runs.map((run) => (
        <li key={run.sessionId} className="flex items-start justify-between gap-3 px-3 py-2.5">
          <div className="min-w-0 space-y-0.5">
            <Link href={`/chats/${run.sessionId}`} className="block truncate text-[13px] font-medium text-[#1c1b19] hover:underline">
              {run.title ?? "Untitled run"}
            </Link>
            <p className="text-[11.5px] text-[#666055]">
              Started {formatWhen(run.startedAt)}
              {run.currentStepName ? ` · at ${run.currentStepName}` : ""}
            </p>
            {run.error && <p className="text-[12px] text-[#b42318]">{run.error}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE_CLASS[runStatusTone(run.status)]}`}>
              {runStatusLabel(run.status)}
            </span>
            {run.status === "failed" && (
              <Button
                size="sm"
                variant="outline"
                disabled={retryingSessionId === run.sessionId}
                onClick={() => onRetry(run.sessionId)}
              >
                Retry
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
