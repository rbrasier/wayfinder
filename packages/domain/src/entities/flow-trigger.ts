// A named, typed value a flow expects when something other than a person starts
// it (ADR-064 §1). Declared on the flow and frozen into each published version,
// so a running session reads the inputs of the version it is pinned to.
export type TriggerInputType = "text" | "number" | "date" | "boolean" | "json";

export interface TriggerInput {
  key: string;
  label: string;
  type: TriggerInputType;
  required: boolean;
}

export type FlowTriggerKind = "webhook";

// A flow's inbound start address (ADR-064 §3). The token itself is never held
// here: only its hash is stored, and the entity exposes just the last four
// characters so the UI can say which token is live.
export interface FlowTrigger {
  id: string;
  flowId: string;
  kind: FlowTriggerKind;
  enabled: boolean;
  tokenLastFour: string | null;
  hasHmacSecret: boolean;
  runAsUserId: string | null;
  createdBy: string | null;
  lastTriggeredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
