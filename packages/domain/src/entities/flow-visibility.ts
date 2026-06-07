import type { FlowVisibility } from "./flow";

export type { FlowVisibility };

export const PRIVATE_VISIBILITY: FlowVisibility = { kind: "private" };
export const GLOBAL_VISIBILITY: FlowVisibility = { kind: "global" };

export const isFlowDiscoverableBy = (
  visibility: FlowVisibility,
  context: { ownerUserId: string; viewerUserId: string },
): boolean => {
  if (visibility.kind === "global") return true;
  return context.ownerUserId === context.viewerUserId;
};

export const canPublishWithVisibility = (
  visibility: FlowVisibility,
  context: { canPublishToEveryone: boolean },
): boolean => {
  if (visibility.kind === "private") return true;
  return context.canPublishToEveryone;
};
