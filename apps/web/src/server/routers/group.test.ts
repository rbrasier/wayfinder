import { canManageGroup, type GroupAuthorizationContext, type PermissionKey } from "@rbrasier/domain";
import { describe, expect, it } from "vitest";
import type { Container } from "@/lib/container";
import { createCallerFactory, router, type TrpcContext } from "../trpc";
import { groupRouter } from "./group";

const testRouter = router({ group: groupRouter });
const createCaller = createCallerFactory(testRouter);

const HR = "11111111-1111-1111-1111-111111111111";
const FIN = "22222222-2222-2222-2222-222222222222";
const USER = "33333333-3333-3333-3333-333333333333";

const ALL_GROUPS = [
  { id: HR, name: "HR", description: null, createdAt: new Date(), updatedAt: new Date() },
  { id: FIN, name: "Finance", description: null, createdAt: new Date(), updatedAt: new Date() },
];

// A container stub whose group use cases run the real domain guard against a fixed
// membership set, so the tests exercise genuine cross-group authorization.
const containerFor = (memberships: GroupAuthorizationContext["memberships"]): Container =>
  ({
    services: { errorLogger: { log: async () => undefined } },
    useCases: {
      resolveGroupAuthorization: {
        execute: async (_userId: string, isGlobalAdmin: boolean) => ({
          data: { memberships, isGlobalAdmin },
        }),
      },
      listManageableGroups: {
        execute: async (context: GroupAuthorizationContext) => ({
          data: ALL_GROUPS.filter((group) => canManageGroup(context, group.id)),
        }),
      },
      listGroupMembers: {
        execute: async (groupId: string) => ({
          data: [{ id: "m1", groupId, userId: "someone", roleInGroup: "member" }],
        }),
      },
      createGroup: { execute: async (input: unknown) => ({ data: { id: "new", ...(input as object) } }) },
      addGroupMember: { execute: async (input: unknown) => ({ data: { id: "m2", ...(input as object) } }) },
    },
  }) as unknown as Container;

const contextFor = (
  memberships: GroupAuthorizationContext["memberships"],
  overrides: Partial<TrpcContext> = {},
): TrpcContext => ({
  container: containerFor(memberships),
  userId: "dana",
  isAdmin: false,
  permissions: new Set<PermissionKey>(["group:manage_own"]),
  headers: new Headers(),
  ...overrides,
});

describe("group router — delegated-admin scoping", () => {
  it("lets a delegated admin list members of their own group", async () => {
    const caller = createCaller(contextFor([{ groupId: HR, roleInGroup: "delegated_admin" }]));
    await expect(caller.group.listMembers({ groupId: HR })).resolves.toHaveLength(1);
  });

  it("rejects a delegated admin of HR reading Finance members", async () => {
    const caller = createCaller(contextFor([{ groupId: HR, roleInGroup: "delegated_admin" }]));
    await expect(caller.group.listMembers({ groupId: FIN })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("rejects a delegated admin adding a member to another group", async () => {
    const caller = createCaller(contextFor([{ groupId: HR, roleInGroup: "delegated_admin" }]));
    await expect(
      caller.group.addMember({
        groupId: FIN,
        userId: USER,
        roleInGroup: "member",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects a plain member managing their own group", async () => {
    const caller = createCaller(contextFor([{ groupId: HR, roleInGroup: "member" }]));
    await expect(caller.group.listMembers({ groupId: HR })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("rejects a delegated admin who lacks the group:manage_own permission", async () => {
    const caller = createCaller(
      contextFor([{ groupId: HR, roleInGroup: "delegated_admin" }], {
        permissions: new Set<PermissionKey>(),
      }),
    );
    await expect(caller.group.listMembers({ groupId: HR })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("rejects a delegated admin promoting a member to delegated admin", async () => {
    const caller = createCaller(contextFor([{ groupId: HR, roleInGroup: "delegated_admin" }]));
    await expect(
      caller.group.addMember({
        groupId: HR,
        userId: USER,
        roleInGroup: "delegated_admin",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects a non-admin creating a group", async () => {
    const caller = createCaller(contextFor([{ groupId: HR, roleInGroup: "delegated_admin" }]));
    await expect(caller.group.create({ name: "New" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lists only the groups a delegated admin manages", async () => {
    const caller = createCaller(contextFor([{ groupId: HR, roleInGroup: "delegated_admin" }]));
    const groups = await caller.group.list();
    expect(groups.map((group) => group.id)).toEqual([HR]);
  });

  it("returns no groups for a caller lacking the manage capability", async () => {
    const caller = createCaller(
      contextFor([{ groupId: HR, roleInGroup: "delegated_admin" }], {
        permissions: new Set<PermissionKey>(),
      }),
    );
    await expect(caller.group.list()).resolves.toEqual([]);
  });
});

describe("group router — global admin", () => {
  it("lets a global admin manage any group and create groups", async () => {
    const caller = createCaller(contextFor([], { isAdmin: true }));
    await expect(caller.group.listMembers({ groupId: FIN })).resolves.toHaveLength(1);
    await expect(caller.group.create({ name: "New" })).resolves.toMatchObject({ id: "new" });
  });

  it("lets a global admin promote a member to delegated admin", async () => {
    const caller = createCaller(contextFor([], { isAdmin: true }));
    await expect(
      caller.group.addMember({
        groupId: HR,
        userId: USER,
        roleInGroup: "delegated_admin",
      }),
    ).resolves.toMatchObject({ roleInGroup: "delegated_admin" });
  });

  it("lists every group for a global admin", async () => {
    const caller = createCaller(contextFor([], { isAdmin: true }));
    const groups = await caller.group.list();
    expect(groups.map((group) => group.id).sort()).toEqual([FIN, HR].sort());
  });
});
