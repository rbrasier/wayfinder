"use client";

import { Suspense, useState } from "react";
import { trpc } from "@/trpc/client";
import { FlowSelector } from "@/components/admin/flow-selector";
import { FieldReportSection } from "@/components/admin/field-report-section";

export function AdminFlowInsights() {
  const [selectedFlowId, setSelectedFlowId] = useState<string | undefined>(undefined);
  const deepDiveQuery = trpc.analytics.flowDeepDive.useQuery({ flowId: selectedFlowId });
  const data = deepDiveQuery.data;

  if (deepDiveQuery.isLoading || !data) {
    return (
      <div className="h-full overflow-auto">
        <div className="container py-8 text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }

  if (data.flows.length === 0) {
    return (
      <div className="h-full overflow-auto">
        <div className="container py-8 text-sm text-muted-foreground">
          No flows yet. Create a flow and run some sessions to see insights here.
        </div>
      </div>
    );
  }

  const activeFlowId = selectedFlowId ?? data.selectedFlowId ?? undefined;

  return (
    <div className="h-full overflow-auto">
      <div className="container space-y-4 py-8">
        <div>
          <h1 className="text-lg font-semibold text-[#1a1814]">Flow insights</h1>
          <p className="text-[13px] text-[#6d6a65]">
            Select a flow to report on the template field values captured across its sessions.
          </p>
        </div>

        <FlowSelector flows={data.flows} activeFlowId={activeFlowId} onSelect={setSelectedFlowId} />

        <Suspense>
          <FieldReportSection
            report={data.fieldReport}
            flowId={activeFlowId ?? ""}
            sessionSummary={data.sessionSummary}
          />
        </Suspense>
      </div>
    </div>
  );
}
