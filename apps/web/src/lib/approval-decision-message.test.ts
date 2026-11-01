import { describe, expect, it } from "vitest";
import { buildApprovalDecisionMessage } from "@wayfinder/domain";
import {
  decisionVerbPhrase,
  formatDecisionMoment,
  isApprovalGranted,
  parseApprovalDecisionMessage,
} from "./approval-decision-message";

const decidedAt = new Date("2026-08-02T10:14:00.000Z");

const built = (overrides: Partial<Parameters<typeof buildApprovalDecisionMessage>[0]> = {}) =>
  buildApprovalDecisionMessage({
    status: "approved",
    approverName: "Rosa Okafor",
    approverEmail: "rosa.okafor@example.com",
    decidedAt,
    comment: null,
    routedBack: false,
    routingError: null,
    offSystemApprovedOn: null,
    ...overrides,
  });

describe("parseApprovalDecisionMessage", () => {
  // The domain builds it and this reads it back. Round-tripping the real builder
  // rather than a hand-written string is the point: a change to either side that
  // the other does not follow fails here instead of in the feed.
  it("round-trips what the domain builder wrote", () => {
    const parsed = parseApprovalDecisionMessage(built());

    expect(parsed?.approverName).toBe("Rosa Okafor");
    expect(parsed?.approverEmail).toBe("rosa.okafor@example.com");
    expect(parsed?.decidedAt.toISOString()).toBe(decidedAt.toISOString());
    expect(parsed?.outcome).toBe("Approval granted.");
  });

  it("keeps the approver's comment as part of the body", () => {
    const parsed = parseApprovalDecisionMessage(
      built({ status: "changes_requested", comment: "I think he should start on Monday 3rd" }),
    );

    expect(parsed?.body).toContain("I think he should start on Monday 3rd");
  });

  it("reads a decision that names no email", () => {
    const parsed = parseApprovalDecisionMessage(built({ approverEmail: null }));

    expect(parsed?.approverName).toBe("Rosa Okafor");
    expect(parsed?.approverEmail).toBeNull();
  });

  it("reads a decision that names nobody", () => {
    const parsed = parseApprovalDecisionMessage(
      built({ approverName: null, approverEmail: null }),
    );

    expect(parsed?.approverName).toBeNull();
    expect(parsed?.decidedAt.toISOString()).toBe(decidedAt.toISOString());
  });

  // Everything else the operator types must render verbatim — a message that
  // merely mentions an approval is not a decision record.
  it("returns null for an ordinary message", () => {
    expect(parseApprovalDecisionMessage("Approval granted, I think?")).toBeNull();
    expect(parseApprovalDecisionMessage("Decided by me at some point.")).toBeNull();
    expect(parseApprovalDecisionMessage("")).toBeNull();
  });

  it("returns null when the timestamp is not a real date", () => {
    expect(
      parseApprovalDecisionMessage("Approval granted.\nDecided by Rosa (r@e.com) at yesterday."),
    ).toBeNull();
  });
});

describe("formatDecisionMoment", () => {
  // The server only knows UTC; the reader wants their own clock. Asserting
  // against toLocaleString keeps this true under whatever timezone CI runs in.
  it("renders the decision moment in the viewer's local time", () => {
    expect(formatDecisionMoment(decidedAt)).toBe(decidedAt.toLocaleString());
  });
});

describe("decisionVerbPhrase", () => {
  // The feed renders "<b>Ada Lovelace</b> granted approval, with edits." — the
  // name leads, so the outcome has to follow it as a verb phrase rather than as
  // the domain's standalone sentence.
  it.each([
    ["Approval granted.", "granted approval."],
    ["Approval granted, with edits made by the approver.", "granted approval, with edits."],
    ["Changes requested by the approver.", "requested a change."],
    [
      "Approval rejected — routed back to the originator.",
      "rejected approval — routed back to the originator.",
    ],
    ["Approval rejected — the request was closed.", "rejected approval — the request was closed."],
  ])("turns %j into %j", (outcome, expected) => {
    expect(decisionVerbPhrase(outcome)).toBe(expected);
  });

  it("passes an unrecognised sentence through untouched", () => {
    // A domain wording change must degrade to the old sentence, never to a
    // blank or a wrong verb.
    expect(decisionVerbPhrase("Something new happened.")).toBe("Something new happened.");
  });
});

describe("an approval recorded off system", () => {
  it("still parses back into the approver, their email and the moment recorded", () => {
    const parsed = parseApprovalDecisionMessage(built({ offSystemApprovedOn: "2026-08-14" }));

    expect(parsed?.approverName).toBe("Rosa Okafor");
    expect(parsed?.approverEmail).toBe("rosa.okafor@example.com");
    expect(parsed?.decidedAt.toISOString()).toBe(decidedAt.toISOString());
  });

  it("reads as a verb phrase after the approver's name, date and all", () => {
    const parsed = parseApprovalDecisionMessage(built({ offSystemApprovedOn: "2026-08-14" }));

    expect(decisionVerbPhrase(parsed!.outcome)).toBe(
      "granted approval off system (approved on 14-08-2026).",
    );
  });

  it("leaves an ordinary approval's verb phrase alone", () => {
    const parsed = parseApprovalDecisionMessage(built());

    expect(decisionVerbPhrase(parsed!.outcome)).toBe("granted approval.");
  });

  it("is still a grant, so the feed offers the signed document under it", () => {
    // `DecideApproval` applies the signature for an off-system decision like any
    // other approval, so there is a signed revision to download.
    const parsed = parseApprovalDecisionMessage(built({ offSystemApprovedOn: "2026-08-14" }));

    expect(isApprovalGranted(parsed!.outcome)).toBe(true);
  });
});

describe("isApprovalGranted", () => {
  // The feed offers the signed document under a decision that granted approval.
  // Nothing is signed by a refusal, and the operator is being sent back to edit
  // rather than to download.
  it.each([
    ["approved" as const, true],
    ["approved_with_edits" as const, true],
    ["changes_requested" as const, false],
    ["rejected" as const, false],
    ["withdrawn" as const, false],
  ])("answers %j with %j", (status, expected) => {
    const parsed = parseApprovalDecisionMessage(built({ status }));

    expect(isApprovalGranted(parsed!.outcome)).toBe(expected);
  });

  it("treats a rejection routed back to the originator as not granted", () => {
    // The rejection sentence differs by whether the work was routed back, so
    // both wordings have to be recognised as refusals.
    const parsed = parseApprovalDecisionMessage(built({ status: "rejected", routedBack: true }));

    expect(isApprovalGranted(parsed!.outcome)).toBe(false);
  });

  it("does not grant an unrecognised sentence", () => {
    // A domain wording change must fail closed: no card is better than a card
    // under a refusal.
    expect(isApprovalGranted("Something new happened.")).toBe(false);
  });
});
