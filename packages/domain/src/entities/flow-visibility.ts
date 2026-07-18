import type { FlowVisibility } from "./flow";

export type { FlowVisibility };

export const PRIVATE_VISIBILITY: FlowVisibility = { kind: "private" };
export const GLOBAL_VISIBILITY: FlowVisibility = { kind: "global" };

export interface FlowDiscoveryContext {
  ownerUserId: string;
  viewerUserId: string;
  // Group ids the viewer belongs to; used only by the `group` visibility kind.
  // Omitted (or empty) means the viewer is in no groups.
  viewerGroupIds?: string[];
  // Organisation each side belongs to; used only by the `organisation` kind
  // (ADR-038). `null`/omitted means unaffiliated, which matches no organisation.
  ownerOrganisationId?: string | null;
  viewerOrganisationId?: string | null;
  // Global admins always discover, including group- and organisation-visible
  // flows (ADR-036 §2).
  viewerIsAdmin?: boolean;
}

export const isFlowDiscoverableBy = (
  visibility: FlowVisibility,
  context: FlowDiscoveryContext,
): boolean => {
  if (visibility.kind === "global") return true;
  if (context.viewerUserId === context.ownerUserId) return true;
  if (visibility.kind === "private") return false;
  if (context.viewerIsAdmin) return true;
  if (visibility.kind === "organisation") {
    const ownerOrganisationId = context.ownerOrganisationId ?? null;
    const viewerOrganisationId = context.viewerOrganisationId ?? null;
    return ownerOrganisationId !== null && ownerOrganisationId === viewerOrganisationId;
  }
  const viewerGroupIds = context.viewerGroupIds ?? [];
  return visibility.groupIds.some((groupId) => viewerGroupIds.includes(groupId));
};

export interface FlowPublishContext {
  canPublishToEveryone: boolean;
  // Groups the caller belongs to; a caller may share a flow only with groups they
  // are in, unless they hold the publish-to-everyone permission (ADR-036 §12).
  callerGroupIds?: string[];
  // Whether the caller belongs to an organisation. Publishing to `organisation`
  // resolves to the owner's own organisation, so a caller with none has nothing
  // to publish to (ADR-038).
  callerHasOrganisation?: boolean;
}

export const canPublishWithVisibility = (
  visibility: FlowVisibility,
  context: FlowPublishContext,
): boolean => {
  if (visibility.kind === "private") return true;
  if (visibility.kind === "global") return context.canPublishToEveryone;
  if (visibility.kind === "organisation") {
    return context.canPublishToEveryone || (context.callerHasOrganisation ?? false);
  }
  if (visibility.groupIds.length === 0) return false;
  if (context.canPublishToEveryone) return true;
  const callerGroupIds = context.callerGroupIds ?? [];
  return visibility.groupIds.every((groupId) => callerGroupIds.includes(groupId));
};
