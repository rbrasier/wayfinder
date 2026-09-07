import { describe, expect, it } from "vitest";
import type { SessionMessage } from "@rbrasier/domain";
import { resolveApprovalDecisionDocument } from "./approval-decision-document";

const message = (overrides: Partial<SessionMessage>): SessionMessage =>
  ({
    id: "m",
    sessionId: "sess-1",
    role: "assistant",
    content: "",
    confidence: null,
    stepNodeId: null,
    senderUserId: null,
    document: null,
    documentStatus: null,
    aiPayload: null,
    createdAt: new Date("2026-08-01T10:00:00Z"),
    updatedAt: new Date("2026-08-01T10:00:00Z"),
    ...overrides,
  }) as SessionMessage;

const doc = (storagePath: string) => ({
  filename: "offer.docx",
  storagePath,
  summary: null,
  generatedAt: "2026-08-01T10:00:00.000Z",
});

const decision = (id: string) => message({ id, role: "user", stepNodeId: "node-approval" });

describe("resolveApprovalDecisionDocument", () => {
  it("finds the document the approver signed", () => {
    const messages = [
      message({ id: "gen", stepNodeId: "node-draft", document: doc("s/offer-r0.docx") }),
      decision("decision"),
    ];

    expect(resolveApprovalDecisionDocument(messages, 1)?.id).toBe("gen");
  });

  it("prefers the newest revision produced before the decision", () => {
    const messages = [
      message({ id: "old", stepNodeId: "node-draft", document: doc("s/offer-r0.docx") }),
      message({ id: "new", stepNodeId: "node-draft", document: doc("s/offer-r1.docx") }),
      decision("decision"),
    ];

    expect(resolveApprovalDecisionDocument(messages, 2)?.id).toBe("new");
  });

  // Two approvals over one document both point at the same message, which is
  // where the signature is written — so both cards download the current,
  // fully-signed revision rather than one approver's intermediate copy.
  it("gives both approvals in a chain the same document", () => {
    const messages = [
      message({ id: "gen", stepNodeId: "node-draft", document: doc("s/offer-r0.docx") }),
      decision("first"),
      decision("second"),
    ];

    expect(resolveApprovalDecisionDocument(messages, 1)?.id).toBe("gen");
    expect(resolveApprovalDecisionDocument(messages, 2)?.id).toBe("gen");
  });

  // A later step's document is not what this approver signed, so it must not be
  // offered under their decision.
  it("ignores a document produced after the decision", () => {
    const messages = [
      decision("decision"),
      message({ id: "later", stepNodeId: "node-letter", document: doc("s/letter-r0.docx") }),
    ];

    expect(resolveApprovalDecisionDocument(messages, 0)).toBeNull();
  });

  it("returns null when the approval is over a step that produced no document", () => {
    const messages = [
      message({ id: "reply", stepNodeId: "node-questions" }),
      decision("decision"),
    ];

    expect(resolveApprovalDecisionDocument(messages, 1)).toBeNull();
  });
});
