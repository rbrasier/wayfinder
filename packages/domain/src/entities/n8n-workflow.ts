import type { TemplateField } from "./template-field";

export interface N8nWebhookTrigger {
  kind: "webhook";
  method: string;
  path: string;
  authentication: string;
}

export interface N8nManualOrScheduledTrigger {
  kind: "manual_or_scheduled";
}

export type N8nTrigger = N8nWebhookTrigger | N8nManualOrScheduledTrigger;

// A workflow mapped from the n8n REST API into the shape Wayfinder needs: a
// dropdown label, the trigger metadata, a derived webhook URL (webhook triggers
// only), and best-effort input/output field schemas inferred by convention.
export interface N8nWorkflowSummary {
  id: string;
  name: string;
  active: boolean;
  trigger: N8nTrigger;
  webhookUrl: string | null;
  inputs: TemplateField[];
  outputs: TemplateField[];
}

// How an input/output schema was discovered. `none` means no method yielded
// anything. Ordered by the fallback chains: inputs try set → pin → expression →
// execution; outputs try set → respond → pin → execution.
export type N8nSchemaMethod = "set" | "pin" | "expression" | "respond" | "execution" | "none";

// The richer, possibly-expensive schema for a single selected workflow. Unlike
// `N8nWorkflowSummary` (free methods only, used by the cheap dropdown), this is
// fetched lazily per workflow and may consult execution history. `hasExecutions`
// reports whether the workflow has ever run, so the UI can explain an empty
// schema.
export interface N8nWorkflowSchema {
  inputs: TemplateField[];
  outputs: TemplateField[];
  inputsMethod: N8nSchemaMethod;
  outputsMethod: N8nSchemaMethod;
  hasExecutions: boolean;
}
