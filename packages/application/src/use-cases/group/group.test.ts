import { describe, expect, it } from "vitest";
import {
  ok,
  type Group,
  type GroupMembership,
  type GroupRole,
  type GroupUpdate,
  type IGroupRepository,
  type NewGroup,
  type NewGroupMembership,
  type Result,
} from "@rbrasier/domain";
import { CreateGroup } from "./create-group";
import { UpdateGroup } from "./update-group";
import { DeleteGroup } from "./delete-group";
import { ListGroups, ListManageableGroups } from "./list-groups";
import { AddGroupMember, ListGroupMembers, RemoveGroupMember, SetGroupMemberRole } from "./group-membership";
import { ResolveGroupAuthorization } from "./resolve-group-authorization";

class FakeGroupRepository implements IGroupRepository {
  groups = new Map<string, Group>();
  members: GroupMembership[] = [];
  private nextId = 1;

  seedGroup(group: Partial<Group> & { id: string; name: string }): Group {
    const full: Group = {
      description: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...group,
    };
    this.groups.set(full.id, full);
    return full;
  }

  seedMember(membership: Partial<GroupMembership> & { groupId: string; userId: string; roleInGroup: GroupRole }): void {
    this.members.push({
      id: `m-${this.nextId++}`,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...membership,
    });
  }

  async list(): Promise<Result<Group[]>> {
    return ok([...this.groups.values()]);
  }
  async findById(id: string): Promise<Result<Group | null>> {
    return ok(this.groups.get(id) ?? null);
  }
  async create(group: NewGroup): Promise<Result<Group>> {
    const created: Group = {
      id: `group-${this.nextId++}`,
      name: group.name,
      description: group.description ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.groups.set(created.id, created);
    return ok(created);
  }
  async update(id: string, patch: GroupUpdate): Promise<Result<Group>> {
    const existing = this.groups.get(id);
    if (!existing) throw new Error("not found");
    const updated: Group = {
      ...existing,
      name: patch.name ?? existing.name,
      description: patch.description === undefined ? existing.description : patch.description,
    };
    this.groups.set(id, updated);
    return ok(updated);
  }
  async delete(id: string): Promise<Result<void>> {
    this.groups.delete(id);
    this.members = this.members.filter((member) => member.groupId !== id);
    return ok(undefined);
  }
  async listMembers(groupId: string): Promise<Result<GroupMembership[]>> {
    return ok(this.members.filter((member) => member.groupId === groupId));
  }
  async listMembershipsForUser(userId: string): Promise<Result<GroupMembership[]>> {
    return ok(this.members.filter((member) => member.userId === userId));
  }
  async addMember(membership: NewGroupMembership): Promise<Result<GroupMembership>> {
    const existing = this.members.find(
      (member) => member.groupId === membership.groupId && member.userId === membership.userId,
    );
    if (existing) {
      existing.roleInGroup = membership.roleInGroup;
      return ok(existing);
    }
    const created: GroupMembership = {
      id: `m-${this.nextId++}`,
      groupId: membership.groupId,
      userId: membership.userId,
      roleInGroup: membership.roleInGroup,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.members.push(created);
    return ok(created);
  }
  async setMemberRole(groupId: string, userId: string, roleInGroup: GroupRole): Promise<Result<GroupMembership>> {
    const existing = this.members.find(
      (member) => member.groupId === groupId && member.userId === userId,
    );
    if (!existing) throw new Error("not found");
    existing.roleInGroup = roleInGroup;
    return ok(existing);
  }
  async removeMember(groupId: string, userId: string): Promise<Result<void>> {
    this.members = this.members.filter(
      (member) => !(member.groupId === groupId && member.userId === userId),
    );
    return ok(undefined);
  }
}

describe("CreateGroup", () => {
  it("creates a group with a trimmed name", async () => {
    const repository = new FakeGroupRepository();
    const result = await new CreateGroup(repository).execute({ name: "  HR  " });
    expect(result.data?.name).toBe("HR");
  });

  it("rejects a blank name", async () => {
    const repository = new FakeGroupRepository();
    const result = await new CreateGroup(repository).execute({ name: "   " });
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });
});

describe("UpdateGroup", () => {
  it("renames a group", async () => {
    const repository = new FakeGroupRepository();
    repository.seedGroup({ id: "hr", name: "HR" });
    const result = await new UpdateGroup(repository).execute("hr", { name: "People" });
    expect(result.data?.name).toBe("People");
  });

  it("rejects a blank name when one is supplied", async () => {
    const repository = new FakeGroupRepository();
    repository.seedGroup({ id: "hr", name: "HR" });
    const result = await new UpdateGroup(repository).execute("hr", { name: "  " });
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });
});

describe("DeleteGroup", () => {
  it("removes the group and its memberships", async () => {
    const repository = new FakeGroupRepository();
    repository.seedGroup({ id: "hr", name: "HR" });
    repository.seedMember({ groupId: "hr", userId: "dana", roleInGroup: "delegated_admin" });
    await new DeleteGroup(repository).execute("hr");
    expect(repository.groups.has("hr")).toBe(false);
    expect(repository.members).toHaveLength(0);
  });
});

describe("ListManageableGroups", () => {
  it("returns every group for a global admin", async () => {
    const repository = new FakeGroupRepository();
    repository.seedGroup({ id: "hr", name: "HR" });
    repository.seedGroup({ id: "fin", name: "Finance" });
    const result = await new ListManageableGroups(repository).execute({
      memberships: [],
      isGlobalAdmin: true,
    });
    expect(result.data?.map((group) => group.id).sort()).toEqual(["fin", "hr"]);
  });

  it("returns only the groups a delegated admin manages", async () => {
    const repository = new FakeGroupRepository();
    repository.seedGroup({ id: "hr", name: "HR" });
    repository.seedGroup({ id: "fin", name: "Finance" });
    const result = await new ListManageableGroups(repository).execute({
      memberships: [{ groupId: "hr", roleInGroup: "delegated_admin" }],
      isGlobalAdmin: false,
    });
    expect(result.data?.map((group) => group.id)).toEqual(["hr"]);
  });

  it("returns nothing for a plain member", async () => {
    const repository = new FakeGroupRepository();
    repository.seedGroup({ id: "hr", name: "HR" });
    const result = await new ListManageableGroups(repository).execute({
      memberships: [{ groupId: "hr", roleInGroup: "member" }],
      isGlobalAdmin: false,
    });
    expect(result.data).toEqual([]);
  });
});

describe("group membership use cases", () => {
  it("adds a member with the default member role", async () => {
    const repository = new FakeGroupRepository();
    repository.seedGroup({ id: "hr", name: "HR" });
    const result = await new AddGroupMember(repository).execute({
      groupId: "hr",
      userId: "amy",
      roleInGroup: "member",
    });
    expect(result.data?.roleInGroup).toBe("member");
  });

  it("promotes a member to delegated admin", async () => {
    const repository = new FakeGroupRepository();
    repository.seedGroup({ id: "hr", name: "HR" });
    repository.seedMember({ groupId: "hr", userId: "amy", roleInGroup: "member" });
    const result = await new SetGroupMemberRole(repository).execute("hr", "amy", "delegated_admin");
    expect(result.data?.roleInGroup).toBe("delegated_admin");
  });

  it("removes a member", async () => {
    const repository = new FakeGroupRepository();
    repository.seedGroup({ id: "hr", name: "HR" });
    repository.seedMember({ groupId: "hr", userId: "amy", roleInGroup: "member" });
    await new RemoveGroupMember(repository).execute("hr", "amy");
    const members = await new ListGroupMembers(repository).execute("hr");
    expect(members.data).toEqual([]);
  });
});

describe("ResolveGroupAuthorization", () => {
  it("marks a global admin regardless of memberships", async () => {
    const repository = new FakeGroupRepository();
    const result = await new ResolveGroupAuthorization(repository).execute("root", true);
    expect(result.data?.isGlobalAdmin).toBe(true);
    expect(result.data?.memberships).toEqual([]);
  });

  it("resolves a user's memberships as authorization views", async () => {
    const repository = new FakeGroupRepository();
    repository.seedMember({ groupId: "hr", userId: "dana", roleInGroup: "delegated_admin" });
    repository.seedMember({ groupId: "fin", userId: "dana", roleInGroup: "member" });
    const result = await new ResolveGroupAuthorization(repository).execute("dana", false);
    expect(result.data?.isGlobalAdmin).toBe(false);
    expect(result.data?.memberships).toEqual([
      { groupId: "hr", roleInGroup: "delegated_admin" },
      { groupId: "fin", roleInGroup: "member" },
    ]);
  });
});
