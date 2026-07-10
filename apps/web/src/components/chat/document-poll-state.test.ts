import { describe, expect, it } from "vitest";
import { hasPendingDocumentGeneration } from "./document-poll-state";

const documentNode = {
  id: "node-1",
  config: { outputType: "generate_document", documentTemplatePath: "tpl.docx" },
};
const conversationalNode = { id: "node-2", config: { outputType: "conversation_only" } };

interface PollMessageOverrides {
  id?: string;
  role?: string;
  confidence?: number | null;
  stepNodeId?: string | null;
  documentStatus?: string | null;
  document?: object | null;
}

const makeMessage = (overrides: PollMessageOverrides = {}) => ({
  id: "m-1",
  role: "assistant",
  confidence: 95,
  stepNodeId: "node-1",
  documentStatus: null,
  document: null,
  ...overrides,
});

describe("hasPendingDocumentGeneration", () => {
  it("polls while the last assistant message on an advanced doc node awaits its document", () => {
    const result = hasPendingDocumentGeneration(
      [makeMessage({ documentStatus: "pending" })],
      "node-2",
      [documentNode, conversationalNode],
    );
    expect(result).toBe(true);
  });

  it("ignores an earlier held reply once a later message on the node carries the document", () => {
    // The pre-generation gate persists the reply it overruled (high confidence,
    // no document, null status). Only the LAST assistant message per node is
    // the one generation attaches to — the held reply must not poll forever.
    const result = hasPendingDocumentGeneration(
      [
        makeMessage({ id: "held", documentStatus: null }),
        makeMessage({ id: "milestone", documentStatus: "complete", document: {} }),
      ],
      "node-2",
      [documentNode, conversationalNode],
    );
    expect(result).toBe(false);
  });

  it("does not poll while the step is still the current node", () => {
    const result = hasPendingDocumentGeneration(
      [makeMessage()],
      "node-1",
      [documentNode],
    );
    expect(result).toBe(false);
  });

  it("does not poll once generation failed", () => {
    const result = hasPendingDocumentGeneration(
      [makeMessage({ documentStatus: "failed" })],
      "node-2",
      [documentNode, conversationalNode],
    );
    expect(result).toBe(false);
  });

  it("does not poll for non-document or template-less nodes", () => {
    const templateLess = { id: "node-3", config: { outputType: "generate_document" } };
    const result = hasPendingDocumentGeneration(
      [
        makeMessage({ stepNodeId: "node-2" }),
        makeMessage({ id: "m-2", stepNodeId: "node-3" }),
      ],
      "node-9",
      [conversationalNode, templateLess],
    );
    expect(result).toBe(false);
  });

  it("treats a null documentStatus on the latest message as still generating (legacy rows)", () => {
    const result = hasPendingDocumentGeneration(
      [makeMessage({ documentStatus: null })],
      "node-2",
      [documentNode, conversationalNode],
    );
    expect(result).toBe(true);
  });

  it("does not poll for low-confidence or non-assistant messages", () => {
    const result = hasPendingDocumentGeneration(
      [
        makeMessage({ confidence: 40 }),
        makeMessage({ id: "sys", role: "system", confidence: null }),
      ],
      "node-2",
      [documentNode],
    );
    expect(result).toBe(false);
  });
});
