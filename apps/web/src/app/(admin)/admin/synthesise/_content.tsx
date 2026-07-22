"use client";

import { EmptyState } from "@/components/empty-state";
import { ExtractionList, type ExtractionFlowRow } from "@/components/extraction/extraction-list";
import { trpc } from "@/trpc/client";

export function AdminSynthesiseContent() {
  const flowsQuery = trpc.extraction.listAll.useQuery();

  if (flowsQuery.error) {
    return (
      <div className="mx-auto max-w-[1000px] px-[20px] py-[28px]">
        <EmptyState
          heading="Synthesise Information is not enabled"
          body="Enable the extraction_flows feature flag under Advanced → Flags to use this surface."
        />
      </div>
    );
  }

  const rows: ExtractionFlowRow[] = (flowsQuery.data ?? []).map((flow) => ({
    id: flow.id,
    name: flow.name,
    status: flow.status,
    runs: [],
  }));

  return (
    <div className="mx-auto max-w-[1000px] px-[20px] py-[28px]">
      <div className="mb-[20px]">
        <h1 className="text-[20px] font-bold text-[#1a1814]">Synthesise Information</h1>
        <p className="mt-[2px] text-[13px] text-[#6d6a65]">
          Every extraction flow across the organisation.
        </p>
      </div>

      {rows.length === 0 ? (
        <EmptyState heading="No extraction flows yet" body="They appear here once authors create them." />
      ) : (
        <ExtractionList flows={rows} editable={false} />
      )}
    </div>
  );
}
