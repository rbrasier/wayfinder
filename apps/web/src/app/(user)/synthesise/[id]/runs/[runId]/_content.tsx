"use client";

import Link from "next/link";
import { RunProgress } from "@/components/extraction/run-progress";
import { RunResults } from "@/components/extraction/run-results";

export function RunScreenContent({ flowId, runId }: { flowId: string; runId: string }) {
  return (
    <div className="mx-auto max-w-[1100px] px-[20px] py-[28px]">
      <div className="mb-[20px]">
        <Link href={`/synthesise/${flowId}/runs`} className="text-[12px] text-[#3a5fd9] hover:underline">
          ← Back to runs
        </Link>
        <h1 className="mt-[4px] text-[20px] font-bold text-[#1a1814]">Run</h1>
      </div>

      <div className="mb-[24px] rounded-[10px] border border-[#e5e1d8] bg-white p-[16px]">
        <RunProgress runId={runId} />
      </div>

      <RunResults flowId={flowId} runId={runId} />
    </div>
  );
}
