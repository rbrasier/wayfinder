import type {
  GroupMembership,
  GroupRole,
  IGroupRepository,
  NewGroupMembership,
  Result,
} from "@rbrasier/domain";

export class ListGroupMembers {
  constructor(private readonly groups: IGroupRepository) {}

  async execute(groupId: string): Promise<Result<GroupMembership[]>> {
    return this.groups.listMembers(groupId);
  }
}

export class AddGroupMember {
  constructor(private readonly groups: IGroupRepository) {}

  async execute(membership: NewGroupMembership): Promise<Result<GroupMembership>> {
    return this.groups.addMember(membership);
  }
}

export class SetGroupMemberRole {
  constructor(private readonly groups: IGroupRepository) {}

  async execute(
    groupId: string,
    userId: string,
    roleInGroup: GroupRole,
  ): Promise<Result<GroupMembership>> {
    return this.groups.setMemberRole(groupId, userId, roleInGroup);
  }
}

export class RemoveGroupMember {
  constructor(private readonly groups: IGroupRepository) {}

  async execute(groupId: string, userId: string): Promise<Result<void>> {
    return this.groups.removeMember(groupId, userId);
  }
}
