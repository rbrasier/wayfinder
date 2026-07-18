import {
  canManageGroup,
  ok,
  type Group,
  type GroupAuthorizationContext,
  type IGroupRepository,
  type Result,
} from "@rbrasier/domain";

export class ListGroups {
  constructor(private readonly groups: IGroupRepository) {}

  async execute(): Promise<Result<Group[]>> {
    return this.groups.list();
  }
}

// The set of groups a caller may administer: all of them for a global admin, only
// the ones they delegate-admin otherwise. Backs the /admin/groups list so a
// delegated admin never sees groups outside their remit (ADR-036 §3).
export class ListManageableGroups {
  constructor(private readonly groups: IGroupRepository) {}

  async execute(context: GroupAuthorizationContext): Promise<Result<Group[]>> {
    const all = await this.groups.list();
    if (all.error) return all;
    return ok(all.data.filter((group) => canManageGroup(context, group.id)));
  }
}
