import type { TemplateField } from "./template-field";

// Where an auto-node request field (or a scheduled node's fire timestamp) gets
// its value at runtime. `ai` is the default and preserves the original
// behaviour: the model fills the value from session context. `step_field` pulls
// a value captured by an earlier step; `literal` is an author-pinned constant;
// `none` deliberately omits the field so it is sent blank.
export type FieldValueSource =
  | { kind: "ai" }
  | { kind: "step_field"; nodeId: string; fieldKey: string }
  | { kind: "literal"; value: string }
  | { kind: "none" };

// A field a prior node is known to declare, surfaced so an author can bind a
// later field's value to it. Derived at config time from the flow graph.
// `stepNumber`/`stepName` drive the grouped value picker; `stepLabel` is kept
// for back-compat with callers that render the combined "N. Name" string.
export interface PriorStepField {
  nodeId: string;
  stepLabel: string;
  stepNumber: number;
  stepName: string;
  field: Pick<TemplateField, "key" | "label" | "type">;
}
