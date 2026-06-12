import type { NodeConfigType } from "./node-config-modal";

// The config persisted for a freshly created node, before the author has saved
// anything. Notifications default on for scheduled steps only. The shapes mirror
// what the config modal reads back, so re-opening shows sensible defaults.
export const defaultConfigForType = (type: NodeConfigType): Record<string, unknown> => {
  if (type === "auto") {
    return {
      instruction: "",
      executor: "n8n",
      workflowId: null,
      webhookUrl: "",
      requestFields: [],
      requestFieldValues: {},
      responseFields: [],
      customRequestFieldKeys: [],
      notifyOnComplete: false,
    };
  }
  if (type === "scheduled") {
    return {
      kind: "relative",
      spec: "1d",
      recurring: false,
      maxOccurrences: null,
      anchor: "node_reached",
      relativeDirection: "after",
      notifyOnComplete: true,
    };
  }
  if (type === "approval") {
    return {
      approverSource: "first_level_supervisor",
      roleHint: "",
      instructions: "",
      notifyOnComplete: true,
    };
  }
  return {
    aiInstruction: "",
    doneWhen: "",
    neverDone: false,
    outputType: "conversation_only",
    documentTemplatePath: null,
    documentTemplateFilename: null,
    documentTemplateContent: null,
    documentTemplateFields: null,
    documentTemplateStructuredContent: null,
    allowManualEdit: true,
    notifyOnComplete: false,
  };
};
