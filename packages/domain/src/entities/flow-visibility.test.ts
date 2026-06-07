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
});
