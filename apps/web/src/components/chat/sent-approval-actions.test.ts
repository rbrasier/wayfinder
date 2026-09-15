import { describe, expect, it } from "vitest";
import { sentApprovalActions } from "./sent-approval-actions";

// The ordinary first approval: the chat's author raised it themselves.
const own = {
  viewerUserId: "operator-1",
  sessionOwnerUserId: "operator-1",
  requestedByUserId: "operator-1",
  isAdmin: false,
  inChat: true,
  offSystemAllowed: true,
};

// The chained shape: approval B's row was raised by approver A, who nominated
// the next signer from their decision modal (ADR-018, v0.22.2).
const chained = { ...own, requestedByUserId: "approver-a" };

describe("sentApprovalActions", () => {
  it("offers all three on a request the author raised themselves", () => {
    const actions = sentApprovalActions(own);

    expect(actions.canEmail).toBe(true);
    expect(actions.canUpdateApprover).toBe(true);
    expect(actions.canWithdraw).toBe(true);
  });

  // The point of the chained card. The author did not raise the row, so
  // withdrawing is not theirs — but changing who it is with is, because
  // withdrawing B would drag the session back past A's completed signature.
  it("offers email and update, but not withdraw, on a chained request", () => {
    const actions = sentApprovalActions(chained);

    expect(actions.canEmail).toBe(true);
    expect(actions.canUpdateApprover).toBe(true);
    expect(actions.canWithdraw).toBe(false);
  });

  it("gives an admin every action regardless of who raised or owns it", () => {
    const actions = sentApprovalActions({
      ...chained,
      viewerUserId: "admin-9",
      sessionOwnerUserId: "someone-else",
      isAdmin: true,
    });

    expect(actions.canEmail).toBe(true);
    expect(actions.canUpdateApprover).toBe(true);
    expect(actions.canWithdraw).toBe(true);
  });

  // Someone who neither owns the session nor raised the row is a bystander.
  it("offers a bystander nothing but the email", () => {
    const actions = sentApprovalActions({
      ...own,
      viewerUserId: "manager-1",
      sessionOwnerUserId: "operator-1",
      requestedByUserId: "operator-1",
    });

    expect(actions.canEmail).toBe(true);
    expect(actions.canUpdateApprover).toBe(false);
    expect(actions.canWithdraw).toBe(false);
  });

  // The picker is also mounted in the approver's decision modal, where the
  // viewer is the approver and the request is not theirs to manage.
  it("offers nothing outside the chat", () => {
    const actions = sentApprovalActions({ ...own, inChat: false });

    expect(actions.canEmail).toBe(false);
    expect(actions.canUpdateApprover).toBe(false);
    expect(actions.canWithdraw).toBe(false);
  });

  // Before `user.me` resolves there is no viewer to compare against; offering
  // an action that will fail is worse than offering it a moment late.
  it("offers no privileged action while the viewer is unknown", () => {
    const actions = sentApprovalActions({ ...own, viewerUserId: null });

    expect(actions.canUpdateApprover).toBe(false);
    expect(actions.canWithdraw).toBe(false);
  });
});

describe("canNominateOffSystem", () => {
  it("offers it to the chat's owner, who is the one watching the request stall", () => {
    expect(sentApprovalActions(own).canNominateOffSystem).toBe(true);
  });

  it("offers it to the previous approver who raised a chained request", () => {
    // They nominated this signer and are the one holding the correspondence,
    // even though the chat is not theirs.
    const actions = sentApprovalActions({
      ...chained,
      viewerUserId: "approver-a",
      sessionOwnerUserId: "operator-1",
    });

    expect(actions.canNominateOffSystem).toBe(true);
  });

  it("offers it to an admin who neither owns the chat nor raised the request", () => {
    const actions = sentApprovalActions({
      ...chained,
      viewerUserId: "admin-9",
      isAdmin: true,
    });

    expect(actions.canNominateOffSystem).toBe(true);
  });

  it("withholds it from a participant who is neither owner nor requester", () => {
    const actions = sentApprovalActions({
      ...chained,
      viewerUserId: "bystander-1",
      sessionOwnerUserId: "operator-1",
    });

    expect(actions.canNominateOffSystem).toBe(false);
  });

  it("withholds it when the approval step's author turned it off", () => {
    expect(sentApprovalActions({ ...own, offSystemAllowed: false }).canNominateOffSystem).toBe(
      false,
    );
  });

  it("withholds it from an admin too when the step forbids it", () => {
    const actions = sentApprovalActions({
      ...own,
      viewerUserId: "admin-9",
      isAdmin: true,
      offSystemAllowed: false,
    });

    expect(actions.canNominateOffSystem).toBe(false);
  });

  it("withholds it in the approver's decision modal, which is not where it belongs", () => {
    expect(sentApprovalActions({ ...own, inChat: false }).canNominateOffSystem).toBe(false);
  });

  it("withholds it from a signed-out viewer", () => {
    const actions = sentApprovalActions({ ...own, viewerUserId: null });

    expect(actions.canNominateOffSystem).toBe(false);
  });
});
