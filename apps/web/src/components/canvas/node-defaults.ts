import type { NodeConfigType } from "./node-config-modal";
import { TEMPLATE_COMPLETE_SENTINEL } from "./output-type";

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
  if (type === "mcp") {
    return {
      instruction: "",
      serverId: "",
      toolName: "",
      requestFields: [],
      requestFieldValues: {},
      responseFields: [],
    };
  }
  return {
    aiInstruction: "",
    // Producing a document is what most steps are for, so a new step starts
    // there with the matching "all fields captured" completion condition.
    doneWhen: TEMPLATE_COMPLETE_SENTINEL,
    neverDone: false,
    outputType: "generate_document",
    structuredFields: null,
    documentTemplatePath: null,
    documentTemplateFilename: null,
    documentTemplateContent: null,
    documentTemplateFields: null,
    documentTemplateStructuredContent: null,
    allowManualEdit: true,
    requireConfirmation: true,
    notifyOnComplete: false,
  };
};
