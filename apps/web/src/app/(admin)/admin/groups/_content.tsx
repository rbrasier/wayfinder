"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/trpc/client";

interface GroupRecord {
  id: string;
  name: string;
  description: string | null;
  organisationId: string | null;
}

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
  const organisationsEnabledQuery = trpc.organisation.isEnabled.useQuery();
  const organisationsQuery = trpc.organisation.list.useQuery(undefined, {
    enabled: organisationsEnabledQuery.data === true,
  });
  const [editing, setEditing] = useState<GroupRecord | "new" | null>(null);

  const organisationsEnabled = organisationsEnabledQuery.data === true;
  const organisations = organisationsQuery.data ?? [];
  const organisationNameById = new Map(organisations.map((org) => [org.id, org.name]));

  const deleteGroup = trpc.group.delete.useMutation({
    onSuccess: async () => {
      toast.success("Group deleted");
      await utils.group.list.invalidate();
    },
    onError: (error) => toast.error(error.message ?? "Failed to delete group"),
  });

  const groups = groupsQuery.data ?? [];

  return (
    <>
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Groups</CardTitle>
          <Button onClick={() => setEditing("new")}>New group</Button>
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
                    {organisationsEnabled && (
                      <p className="text-xs text-muted-foreground">
                        {group.organisationId
                          ? `Organisation: ${organisationNameById.get(group.organisationId) ?? "Unknown"}`
                          : "Global (all organisations)"}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditing(group)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={deleteGroup.isPending}
                      onClick={() => deleteGroup.mutate({ groupId: group.id })}
                    >
                      Delete
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <GroupModal
        open={editing !== null}
        group={editing === "new" ? null : editing}
        onClose={() => setEditing(null)}
        organisationsEnabled={organisationsEnabled}
        organisations={organisations}
      />

      {groups.map((group) => (
        <GroupMembershipPanel key={group.id} groupId={group.id} groupName={group.name} />
      ))}
    </>
  );
}

function GroupModal({
  open,
  group,
  onClose,
  organisationsEnabled,
  organisations,
}: {
  open: boolean;
  group: GroupRecord | null;
  onClose: () => void;
  organisationsEnabled: boolean;
  organisations: { id: string; name: string }[];
}) {
  const utils = trpc.useUtils();
  const isEdit = group !== null;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [organisationId, setOrganisationId] = useState("");

  const createGroup = trpc.group.create.useMutation({
    onSuccess: async () => {
      toast.success("Group created");
      await utils.group.list.invalidate();
      onClose();
    },
    onError: (error) => toast.error(error.message ?? "Failed to create group"),
  });
  const updateGroup = trpc.group.update.useMutation({
    onSuccess: async () => {
      toast.success("Group updated");
      await utils.group.list.invalidate();
      onClose();
    },
    onError: (error) => toast.error(error.message ?? "Failed to update group"),
  });

  useEffect(() => {
    if (open) {
      setName(group?.name ?? "");
      setDescription(group?.description ?? "");
      setOrganisationId(group?.organisationId ?? "");
    }
  }, [open, group]);

  const isSaving = createGroup.isPending || updateGroup.isPending;

  const handleSave = () => {
    if (!name.trim()) return;
    const description_ = description.trim() === "" ? null : description.trim();
    const organisationId_ =
      organisationsEnabled && organisationId ? organisationId : null;
    if (isEdit) {
      updateGroup.mutate({
        groupId: group.id,
        name: name.trim(),
        description: description_,
        ...(organisationsEnabled ? { organisationId: organisationId_ } : {}),
      });
      return;
    }
    createGroup.mutate({
      name: name.trim(),
      ...(description_ ? { description: description_ } : {}),
      ...(organisationId_ ? { organisationId: organisationId_ } : {}),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit group" : "New group"}</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>
        <DialogBody>
          <div className="space-y-1">
            <Label htmlFor="group-name">Name</Label>
            <Input
              id="group-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && handleSave()}
              placeholder="e.g. Procurement"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="group-description">Description (optional)</Label>
            <Textarea
              id="group-description"
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What is this group for?"
            />
          </div>
          {organisationsEnabled && (
            <div className="space-y-1">
              <Label htmlFor="group-org">Organisation</Label>
              <select
                id="group-org"
                className="flex h-10 w-full rounded-md border border-[#d6d2ca] bg-white px-2 text-sm"
                value={organisationId}
                onChange={(event) => setOrganisationId(event.target.value)}
              >
                <option value="">Global (all organisations)</option>
                {organisations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving || !name.trim()}>
            {isEdit ? "Save changes" : "Create group"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
