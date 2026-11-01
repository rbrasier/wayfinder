"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { trpc } from "@/trpc/client";
import { runFitNotices, type RunFitNotice } from "./run-fit-notice-model";

// The pre-run size check (issue #335). The estimate sizes the *saved* schema, so
// it is refreshed whenever the intake or the saved schema changes, and checked
// fresh once more right before a run starts — a stale "too large" must never
// lock out an author who has just trimmed their context material.
export function useRunFit(flowId: string, stagedDocumentCount: number) {
  const utils = trpc.useUtils();
  const estimateQuery = trpc.extraction.estimateRunFit.useQuery({ flowId });

  const refresh = () => utils.extraction.estimateRunFit.invalidate({ flowId });

  useEffect(() => {
    void utils.extraction.estimateRunFit.invalidate({ flowId });
  }, [utils, flowId, stagedDocumentCount]);

  // Call after the schema is saved: true (with the reason toasted) when the run
  // must not start.
  const blocksRun = async (): Promise<boolean> => {
    await refresh();
    const fresh = await utils.extraction.estimateRunFit.fetch({ flowId });
    const [blocking] = runFitNotices(fresh).filter((notice) => notice.tone === "block");
    if (!blocking) return false;
    toast.error(blocking.message);
    return true;
  };

  return { notices: runFitNotices(estimateQuery.data ?? null), refresh, blocksRun };
}

export function RunFitNotices({ notices }: { notices: RunFitNotice[] }) {
  if (notices.length === 0) return null;

  return (
    <ul role="status" aria-label="Run size check" className="mt-2 space-y-1.5">
      {notices.map((notice) => (
        <li
          key={notice.message}
          className={
            notice.tone === "block"
              ? "rounded-[9px] border border-[#f1c8c0] bg-[#fbecea] px-3 py-2 text-[12px] text-[#b23b30]"
              : "rounded-[9px] border border-[#f0dcb4] bg-[#fbf4e6] px-3 py-2 text-[12px] text-[#7a5a17]"
          }
        >
          {notice.message}
        </li>
      ))}
    </ul>
  );
}
