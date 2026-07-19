import { describe, expect, it } from "vitest";
import {
  canPublishWithVisibility,
  isFlowDiscoverableBy,
  type FlowVisibility,
} from "./flow-visibility";

describe("isFlowDiscoverableBy", () => {
  it("returns true for global flows regardless of viewer", () => {
    const visibility: FlowVisibility = { kind: "global" };
    const discoverable = isFlowDiscoverableBy(visibility, {
      ownerUserId: "owner-1",
      viewerUserId: "someone-else",
    });
    expect(discoverable).toBe(true);
  });

  it("returns true for private flows when the viewer is the owner", () => {
    const visibility: FlowVisibility = { kind: "private" };
    const discoverable = isFlowDiscoverableBy(visibility, {
      ownerUserId: "owner-1",
      viewerUserId: "owner-1",
    });
    expect(discoverable).toBe(true);
  });

  it("returns false for private flows when the viewer is not the owner", () => {
    const visibility: FlowVisibility = { kind: "private" };
    const discoverable = isFlowDiscoverableBy(visibility, {
      ownerUserId: "owner-1",
      viewerUserId: "someone-else",
    });
    expect(discoverable).toBe(false);
  });

  it("returns true for group flows when the viewer belongs to one of the groups", () => {
    const visibility: FlowVisibility = { kind: "group", groupIds: ["hr", "legal"] };
    const discoverable = isFlowDiscoverableBy(visibility, {
      ownerUserId: "owner-1",
      viewerUserId: "someone-else",
      viewerGroupIds: ["finance", "hr"],
    });
    expect(discoverable).toBe(true);
  });

  it("returns false for group flows when the viewer belongs to none of the groups", () => {
    const visibility: FlowVisibility = { kind: "group", groupIds: ["hr"] };
    const discoverable = isFlowDiscoverableBy(visibility, {
      ownerUserId: "owner-1",
      viewerUserId: "someone-else",
      viewerGroupIds: ["finance"],
    });
    expect(discoverable).toBe(false);
  });

  it("returns false for group flows when the viewer has no group memberships", () => {
    const visibility: FlowVisibility = { kind: "group", groupIds: ["hr"] };
    const discoverable = isFlowDiscoverableBy(visibility, {
      ownerUserId: "owner-1",
      viewerUserId: "someone-else",
    });
    expect(discoverable).toBe(false);
  });

  it("returns true for group flows when the viewer is the owner even without membership", () => {
    const visibility: FlowVisibility = { kind: "group", groupIds: ["hr"] };
    const discoverable = isFlowDiscoverableBy(visibility, {
      ownerUserId: "owner-1",
      viewerUserId: "owner-1",
    });
    expect(discoverable).toBe(true);
  });

  it("returns true for group flows when the viewer is a global admin", () => {
    const visibility: FlowVisibility = { kind: "group", groupIds: ["hr"] };
    const discoverable = isFlowDiscoverableBy(visibility, {
      ownerUserId: "owner-1",
      viewerUserId: "someone-else",
      viewerIsAdmin: true,
    });
    expect(discoverable).toBe(true);
  });

  it("returns true for organisation flows when viewer and owner share an organisation", () => {
    const visibility: FlowVisibility = { kind: "organisation" };
    const discoverable = isFlowDiscoverableBy(visibility, {
      ownerUserId: "owner-1",
      viewerUserId: "someone-else",
      ownerOrganisationId: "org-hr",
      viewerOrganisationId: "org-hr",
    });
    expect(discoverable).toBe(true);
  });

  it("returns false for organisation flows when the organisations differ", () => {
    const visibility: FlowVisibility = { kind: "organisation" };
    const discoverable = isFlowDiscoverableBy(visibility, {
      ownerUserId: "owner-1",
      viewerUserId: "someone-else",
      ownerOrganisationId: "org-hr",
      viewerOrganisationId: "org-procurement",
    });
    expect(discoverable).toBe(false);
  });

  it("returns false for organisation flows when the viewer has no organisation", () => {
    const visibility: FlowVisibility = { kind: "organisation" };
    const discoverable = isFlowDiscoverableBy(visibility, {
      ownerUserId: "owner-1",
      viewerUserId: "someone-else",
      ownerOrganisationId: "org-hr",
      viewerOrganisationId: null,
    });
    expect(discoverable).toBe(false);
  });

  it("returns false for organisation flows when the owner has no organisation", () => {
    const visibility: FlowVisibility = { kind: "organisation" };
    const discoverable = isFlowDiscoverableBy(visibility, {
      ownerUserId: "owner-1",
      viewerUserId: "someone-else",
      ownerOrganisationId: null,
      viewerOrganisationId: "org-hr",
    });
    expect(discoverable).toBe(false);
  });

  it("returns true for organisation flows when the viewer is the owner even with no organisation", () => {
    const visibility: FlowVisibility = { kind: "organisation" };
    const discoverable = isFlowDiscoverableBy(visibility, {
      ownerUserId: "owner-1",
      viewerUserId: "owner-1",
    });
    expect(discoverable).toBe(true);
  });

  it("returns true for organisation flows when the viewer is a global admin", () => {
    const visibility: FlowVisibility = { kind: "organisation" };
    const discoverable = isFlowDiscoverableBy(visibility, {
      ownerUserId: "owner-1",
      viewerUserId: "someone-else",
      ownerOrganisationId: "org-hr",
      viewerOrganisationId: "org-procurement",
      viewerIsAdmin: true,
    });
    expect(discoverable).toBe(true);
  });
});

describe("canPublishWithVisibility", () => {
  it("allows any user to publish a private flow", () => {
    const allowed = canPublishWithVisibility({ kind: "private" }, { canPublishToEveryone: false });
    expect(allowed).toBe(true);
  });

  it("allows holders of the publish permission to publish a global flow", () => {
    const allowed = canPublishWithVisibility({ kind: "global" }, { canPublishToEveryone: true });
    expect(allowed).toBe(true);
  });

  it("rejects users without the publish permission publishing a global flow", () => {
    const allowed = canPublishWithVisibility({ kind: "global" }, { canPublishToEveryone: false });
    expect(allowed).toBe(false);
  });

  it("allows any user to publish a private flow regardless of permission", () => {
    const allowed = canPublishWithVisibility({ kind: "private" }, { canPublishToEveryone: true });
    expect(allowed).toBe(true);
  });

  it("allows publishing to groups the caller belongs to", () => {
    const allowed = canPublishWithVisibility(
      { kind: "group", groupIds: ["hr"] },
      { canPublishToEveryone: false, callerGroupIds: ["hr", "finance"] },
    );
    expect(allowed).toBe(true);
  });

  it("rejects publishing to a group the caller does not belong to", () => {
    const allowed = canPublishWithVisibility(
      { kind: "group", groupIds: ["hr", "finance"] },
      { canPublishToEveryone: false, callerGroupIds: ["hr"] },
    );
    expect(allowed).toBe(false);
  });

  it("lets a global publisher publish to any group without membership", () => {
    const allowed = canPublishWithVisibility(
      { kind: "group", groupIds: ["hr", "finance"] },
      { canPublishToEveryone: true },
    );
    expect(allowed).toBe(true);
  });

  it("rejects publishing to an empty group list", () => {
    const allowed = canPublishWithVisibility(
      { kind: "group", groupIds: [] },
      { canPublishToEveryone: true },
    );
    expect(allowed).toBe(false);
  });

  it("allows publishing to the organisation when the caller belongs to one", () => {
    const allowed = canPublishWithVisibility(
      { kind: "organisation" },
      { canPublishToEveryone: false, callerHasOrganisation: true },
    );
    expect(allowed).toBe(true);
  });

  it("rejects an organisation publish when the caller has no organisation", () => {
    const allowed = canPublishWithVisibility(
      { kind: "organisation" },
      { canPublishToEveryone: false, callerHasOrganisation: false },
    );
    expect(allowed).toBe(false);
  });

  it("lets a global publisher publish to the organisation regardless of membership", () => {
    const allowed = canPublishWithVisibility(
      { kind: "organisation" },
      { canPublishToEveryone: true, callerHasOrganisation: false },
    );
    expect(allowed).toBe(true);
  });
});
