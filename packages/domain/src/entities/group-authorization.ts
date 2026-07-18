import type { GroupMembership, GroupRole } from "./group-membership";

// The subset of a membership the authorization predicates need. Callers pass the
// viewer's memberships resolved per request so revocation takes effect immediately.
export interface GroupMembershipView {
  readonly groupId: string;
  readonly roleInGroup: GroupRole;
}

export interface GroupAuthorizationContext {
  readonly memberships: readonly GroupMembershipView[];
  readonly isGlobalAdmin: boolean;
}

const toView = (membership: Pick<GroupMembership, "groupId" | "roleInGroup">): GroupMembershipView => ({
  groupId: membership.groupId,
  roleInGroup: membership.roleInGroup,
});

export const membershipViews = (
  memberships: readonly Pick<GroupMembership, "groupId" | "roleInGroup">[],
): GroupMembershipView[] => memberships.map(toView);

// Every group id the viewer belongs to, in any role. Used to resolve group-scoped
// flow discovery (ADR-036 §2).
export const groupIdsForMemberships = (
  memberships: readonly GroupMembershipView[],
): string[] => memberships.map((membership) => membership.groupId);

// Pure predicate: is the viewer a delegated admin *of this group*? Membership with
// role_in_group = delegated_admin, nothing more. Global-admin power is layered on
// top by `canManageGroup`, never folded in here.
export const isDelegatedAdminOf = (
  context: GroupAuthorizationContext,
  groupId: string,
): boolean =>
  context.memberships.some(
    (membership) => membership.groupId === groupId && membership.roleInGroup === "delegated_admin",
  );

// The single guard every group-scoped action runs through (ADR-036 §3): a global
// admin may manage any group; anyone else only a group they delegate-admin. This
// is the one place cross-group access is decided, so the negative paths are
// enforced and tested in one spot.
export const canManageGroup = (
  context: GroupAuthorizationContext,
  groupId: string,
): boolean => context.isGlobalAdmin || isDelegatedAdminOf(context, groupId);
