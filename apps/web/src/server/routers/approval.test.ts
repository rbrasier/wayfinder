import { describe, expect, it, vi } from "vitest";
import { ok } from "@rbrasier/domain";
import type { Container } from "@/lib/container";
import { createCallerFactory, router, type TrpcContext } from "../trpc";
import { approvalRouter } from "./approval";

const createCaller = createCallerFactory(router({ approval: approvalRouter }));

const approvalId = "11111111-1111-1111-1111-111111111111";

const publish = vi.fn().mockResolvedValue(undefined);

const makeContainer = (): Container =>
  ({
    services: {
      errorLogger: { log: async () => undefined },
      // The chat's EventSource is keyed on this. A decision that does not
      // publish leaves every open chat showing a request that has moved on.
      sessionEvents: { publish },
    },
    repos: { users: { findById: vi.fn().mockResolvedValue(ok({ email: "a@b.c" })) } },
    useCases: {
      decideApproval: {
        execute: vi.fn().mockResolvedValue(
          ok({
            approval: { id: approvalId, sessionId: "sess-1" },
            advanced: true,
            newNodeId: null,
            sessionCompleted: false,
          }),
        ),
      },
      resolveDecisionNotifyTargets: { execute: vi.fn().mockResolvedValue(ok([])) },
      recordOffSystemApproval: {
        execute: vi.fn().mockResolvedValue(
          ok({
            approval: { id: approvalId, sessionId: "sess-1" },
            advanced: true,
            newNodeId: null,
            sessionCompleted: false,
          }),
        ),
      },
    },
  }) as unknown as Container;

const contextWith = (container: Container): TrpcContext => ({
  container,
  userId: "user-1",
  isAdmin: false,
  permissions: new Set(),
  headers: new Headers(),
});

describe("approval.decide", () => {
  it("tells open chats the session changed", async () => {
    publish.mockClear();
    const caller = createCaller(contextWith(makeContainer()));

    await caller.approval.decide({ approvalId, decision: "approved" });

    // Keyed on the session, not the approval — the chat watches the session.
    expect(publish).toHaveBeenCalledWith("sess-1", { type: "session.updated" });
  });

  // `approved_with_edits` is derived by the system, never chosen. If it ever
  // becomes selectable the control is worthless — an approver could claim it
  // without editing, or withhold it after editing (ADR-045 §4).
  it("accepts exactly the three decisions an approver can choose", async () => {
    const container = makeContainer();
    const caller = createCaller(contextWith(container));

    for (const decision of ["approved", "rejected", "changes_requested"] as const) {
      await expect(caller.approval.decide({ approvalId, decision })).resolves.toBeTruthy();
    }
  });

  it("refuses approved_with_edits as an approver-selectable decision", async () => {
    const caller = createCaller(contextWith(makeContainer()));

    await expect(
      caller.approval.decide({
        approvalId,
        decision: "approved_with_edits" as never,
      }),
    ).rejects.toThrow();
  });
});

describe("approval.recordOffSystem", () => {
  const validInput = {
    approvalId,
    approvedOn: "2026-08-14",
    evidenceFilename: "signed-memo.pdf",
    evidenceMimeType: "application/pdf",
    evidenceContentBase64: Buffer.from("a scan", "utf8").toString("base64"),
  };

  it("records the caller as the nominator, never as the approver", async () => {
    const container = makeContainer();
    const caller = createCaller(contextWith(container));

    await caller.approval.recordOffSystem(validInput);

    const call = vi.mocked(container.useCases.recordOffSystemApproval.execute).mock.calls[0]![0];
    expect(call.nominatedByUserId).toBe("user-1");
    expect(call).not.toHaveProperty("decidedByUserId");
  });

  it("decodes the evidence into bytes for the use case", async () => {
    const container = makeContainer();
    const caller = createCaller(contextWith(container));

    await caller.approval.recordOffSystem(validInput);

    const call = vi.mocked(container.useCases.recordOffSystemApproval.execute).mock.calls[0]![0];
    expect(call.evidence.bytes.toString("utf8")).toBe("a scan");
    expect(call.evidence.filename).toBe("signed-memo.pdf");
  });

  it("tells open chats the session changed", async () => {
    publish.mockClear();
    const caller = createCaller(contextWith(makeContainer()));

    await caller.approval.recordOffSystem(validInput);

    expect(publish).toHaveBeenCalledWith("sess-1", { type: "session.updated" });
  });

  it("rejects a date that is not a calendar date", async () => {
    const caller = createCaller(contextWith(makeContainer()));

    await expect(
      caller.approval.recordOffSystem({ ...validInput, approvedOn: "14/08/2026" }),
    ).rejects.toThrow();
  });

  it("rejects a nomination with no evidence attached", async () => {
    const caller = createCaller(contextWith(makeContainer()));

    await expect(
      caller.approval.recordOffSystem({ ...validInput, evidenceContentBase64: "" }),
    ).rejects.toThrow();
  });

  it("rejects evidence larger than the payload ceiling", async () => {
    const caller = createCaller(contextWith(makeContainer()));

    await expect(
      caller.approval.recordOffSystem({
        ...validInput,
        evidenceContentBase64: "A".repeat(15 * 1024 * 1024),
      }),
    ).rejects.toThrow();
  });
});
