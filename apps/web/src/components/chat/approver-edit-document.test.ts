import { describe, expect, it } from "vitest";
import type { SessionMessage } from "@wayfinder/domain";
import { resolveApproverEditDocument } from "./approver-edit-document";

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

describe("resolveApproverEditDocument", () => {
  it("finds the document the announcement is about, by its step", () => {
    const messages = [
      message({ id: "gen", stepNodeId: "node-draft", document: doc("s/offer-r0.docx") }),
      message({ id: "note", role: "system", stepNodeId: "node-draft" }),
    ];

    expect(resolveApproverEditDocument(messages, "node-draft")?.id).toBe("gen");
  });

  it("prefers the newest revision when a step generated more than one", () => {
    // Matches how the approver's own queue resolves it, so the originator's
    // thread and the approver's queue can never show different revisions.
    const messages = [
      message({
        id: "old",
        stepNodeId: "node-draft",
        document: doc("s/offer-r0.docx"),
        createdAt: new Date("2026-08-01T10:00:00Z"),
      }),
      message({
        id: "new",
        stepNodeId: "node-draft",
        document: doc("s/offer-r1.docx"),
        createdAt: new Date("2026-08-01T12:00:00Z"),
      }),
    ];

    expect(resolveApproverEditDocument(messages, "node-draft")?.id).toBe("new");
  });

  it("ignores documents belonging to a different step", () => {
    const messages = [
      message({ id: "other", stepNodeId: "node-elsewhere", document: doc("s/other.docx") }),
    ];

    expect(resolveApproverEditDocument(messages, "node-draft")).toBeNull();
  });

  it("returns null when the announcement carries no step", () => {
    const messages = [message({ id: "gen", stepNodeId: "node-draft", document: doc("s/a.docx") })];

    expect(resolveApproverEditDocument(messages, null)).toBeNull();
  });

  it("returns null when the step produced no document", () => {
    // A structured step has fields, not a document. Nothing to attach.
    const messages = [message({ id: "note", role: "system", stepNodeId: "node-draft" })];

    expect(resolveApproverEditDocument(messages, "node-draft")).toBeNull();
  });
});
