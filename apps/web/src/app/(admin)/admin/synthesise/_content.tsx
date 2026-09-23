"use client";

import { EmptyState } from "@/components/empty-state";
import { ExtractionList, type ExtractionFlowRow } from "@/components/extraction/extraction-list";
import { trpc } from "@/trpc/client";

export function AdminSynthesiseContent() {
  const flowsQuery = trpc.extraction.listAll.useQuery();

  const rows: ExtractionFlowRow[] = (flowsQuery.data ?? []).map((flow) => ({
    id: flow.id,
    name: flow.name,
    runs: [],
  }));

  // Deliberately the admin oversight layout — a fixed page header and the wide
  // container the other "All …" admin pages use — rather than the operator's
  // /synthesise workspace, which is a working surface with a create action.
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-[#e7e3db] bg-white pl-5 pr-[52px]">
        <h1 className="text-[16px] font-bold tracking-[-0.3px] text-[#1c1b19]">All Syntheses</h1>
        <span className="text-[12px] text-[#666055]">
          Every extraction flow across the organisation
        </span>
      </header>

      <div className="flex-1 overflow-auto">
        <div className="container py-8">
          {flowsQuery.isPending ? (
            <p className="text-[13px] text-[#736d5f]">Loading…</p>
          ) : flowsQuery.error ? (
            <EmptyState
              heading="Synthesise Information is not enabled"
              body="Enable the extraction_flows feature flag under Advanced → Flags to use this surface."
            />
          ) : rows.length === 0 ? (
            <EmptyState
              icon="🧪"
              heading="No extraction flows yet"
              body="They appear here once authors create them."
            />
          ) : (
            <ExtractionList flows={rows} editable={false} />
          )}
        </div>
      </div>
    </div>
  );
}
