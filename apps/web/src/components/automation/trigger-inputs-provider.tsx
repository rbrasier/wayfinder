"use client";

import type { ReactNode } from "react";
import { TriggerInputsContext } from "@/components/canvas/field-value-selector";
import { trpc } from "@/trpc/client";

// Makes the flow's declared trigger inputs available to every value picker in
// the flow editor (ADR-064 §2).
export function TriggerInputsProvider({ flowId, children }: { flowId: string; children: ReactNode }) {
  const triggers = trpc.automation.flowTriggers.useQuery({ flowId }, { retry: false });
  return (
    <TriggerInputsContext.Provider value={triggers.data?.triggerInputs ?? []}>{children}</TriggerInputsContext.Provider>
  );
}
