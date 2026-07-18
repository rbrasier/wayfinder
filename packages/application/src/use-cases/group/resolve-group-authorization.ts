import {
  membershipViews,
  ok,
  type GroupAuthorizationContext,
  type IGroupRepository,
  type Result,
} from "@rbrasier/domain";

// Resolves the per-request group authorization context — the caller's memberships
// plus the global-admin flag — so the router's guard and group-scoped flow
// discovery decide access against live membership (revocation is immediate).
export class ResolveGroupAuthorization {
  constructor(private readonly groups: IGroupRepository) {}

  async execute(userId: string, isGlobalAdmin: boolean): Promise<Result<GroupAuthorizationContext>> {
    const memberships = await this.groups.listMembershipsForUser(userId);
    if (memberships.error) return memberships;
    return ok({ memberships: membershipViews(memberships.data), isGlobalAdmin });
  }
}
