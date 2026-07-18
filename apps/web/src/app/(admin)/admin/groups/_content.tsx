"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/trpc/client";

export function AdminGroupsContent() {
  return (
    <div className="h-full overflow-auto">
      <div className="container space-y-8 py-8">
        <GroupsManagementCard />
      </div>
    </div>
  );
}

function GroupsManagementCard() {
  const utils = trpc.useUtils();
  const groupsQuery = trpc.group.list.useQuery();
  const [newGroupName, setNewGroupName] = useState("");

  const createGroup = trpc.group.create.useMutation({
    onSuccess: async () => {
      toast.success("Group created");
      setNewGroupName("");
      await utils.group.list.invalidate();
    },
    onError: (error) => toast.error(error.message ?? "Failed to create group"),
  });
  const deleteGroup = trpc.group.delete.useMutation({
    onSuccess: async () => {
      toast.success("Group deleted");
      await utils.group.list.invalidate();
    },
    onError: (error) => toast.error(error.message ?? "Failed to delete group"),
  });

  const handleCreate = () => {
    if (!newGroupName.trim()) return;
    createGroup.mutate({ name: newGroupName.trim() });
  };

  const groups = groupsQuery.data ?? [];

  return (
    <>
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Groups</CardTitle>
          <div className="flex gap-2">
            <Input
              placeholder="New group name"
              value={newGroupName}
              onChange={(event) => setNewGroupName(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && handleCreate()}
              className="max-w-[220px]"
            />
            <Button onClick={handleCreate} disabled={createGroup.isPending || !newGroupName.trim()}>
              Add group
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {groupsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">No groups yet.</p>
          ) : (
            <ul className="divide-y divide-[#ece9e3]">
              {groups.map((group) => (
                <li key={group.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <span className="font-medium text-[#1a1814]">{group.name}</span>
                    {group.description && (
                      <p className="text-xs text-muted-foreground">{group.description}</p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={deleteGroup.isPending}
                    onClick={() => deleteGroup.mutate({ groupId: group.id })}
                  >
                    Delete
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {groups.map((group) => (
        <GroupMembershipPanel key={group.id} groupId={group.id} groupName={group.name} />
      ))}
    </>
  );
}

function GroupMembershipPanel({ groupId, groupName }: { groupId: string; groupName: string }) {
  const utils = trpc.useUtils();
  const usersQuery = trpc.user.list.useQuery({});
  const membersQuery = trpc.group.listMembers.useQuery({ groupId });
  const [selectedUserId, setSelectedUserId] = useState("");

  const refresh = () => utils.group.listMembers.invalidate({ groupId });

  const addMember = trpc.group.addMember.useMutation({
    onSuccess: () => void refresh(),
    onError: (error) => toast.error(error.message ?? "Failed to add member"),
  });
  const removeMember = trpc.group.removeMember.useMutation({
    onSuccess: () => void refresh(),
    onError: (error) => toast.error(error.message ?? "Failed to remove member"),
  });
  const setMemberRole = trpc.group.setMemberRole.useMutation({
    onSuccess: () => void refresh(),
    onError: (error) => toast.error(error.message ?? "Failed to update role"),
  });

  const members = membersQuery.data ?? [];
  const memberIds = new Set(members.map((member) => member.userId));
  const users = usersQuery.data ?? [];
  const usersById = new Map(users.map((user) => [user.id, user]));
  const nonMembers = users.filter((user) => !memberIds.has(user.id) && !user.isAdmin);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{groupName} — Members</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <select
            aria-label={`Add a user to ${groupName}`}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={selectedUserId}
            onChange={(event) => setSelectedUserId(event.target.value)}
          >
            <option value="">Select a user…</option>
            {nonMembers.map((user) => (
              <option key={user.id} value={user.id}>
                {user.email}
              </option>
            ))}
          </select>
          <Button
            disabled={!selectedUserId || addMember.isPending}
            onClick={() => {
              if (!selectedUserId) return;
              addMember.mutate({ groupId, userId: selectedUserId, roleInGroup: "member" });
              setSelectedUserId("");
            }}
          >
            Add member
          </Button>
        </div>

        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground">No members yet.</p>
        ) : (
          <ul className="space-y-2">
            {members.map((member) => {
              const isDelegatedAdmin = member.roleInGroup === "delegated_admin";
              return (
                <li key={member.id} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 font-mono text-xs">
                    {usersById.get(member.userId)?.email ?? member.userId}
                    {isDelegatedAdmin && <Badge variant="outline">delegated admin</Badge>}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={setMemberRole.isPending}
                      onClick={() =>
                        setMemberRole.mutate({
                          groupId,
                          userId: member.userId,
                          roleInGroup: isDelegatedAdmin ? "member" : "delegated_admin",
                        })
                      }
                    >
                      {isDelegatedAdmin ? "Revoke admin" : "Make delegated admin"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={removeMember.isPending}
                      onClick={() => removeMember.mutate({ groupId, userId: member.userId })}
                    >
                      Remove
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
