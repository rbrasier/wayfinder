import type { Group, GroupUpdate, NewGroup } from "../entities/group";
import type { GroupMembership, GroupRole, NewGroupMembership } from "../entities/group-membership";
import type { Result } from "../result";

export interface IGroupRepository {
  list(): Promise<Result<Group[]>>;
  findById(id: string): Promise<Result<Group | null>>;
  create(group: NewGroup): Promise<Result<Group>>;
  update(id: string, patch: GroupUpdate): Promise<Result<Group>>;
  delete(id: string): Promise<Result<void>>;
  listMembers(groupId: string): Promise<Result<GroupMembership[]>>;
  listMembershipsForUser(userId: string): Promise<Result<GroupMembership[]>>;
  addMember(membership: NewGroupMembership): Promise<Result<GroupMembership>>;
  setMemberRole(
    groupId: string,
    userId: string,
    roleInGroup: GroupRole,
  ): Promise<Result<GroupMembership>>;
  removeMember(groupId: string, userId: string): Promise<Result<void>>;
}
