"use client";

import { PERMISSIONS, type PermissionKey } from "@rbrasier/domain";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/trpc/client";

// Permissions whose enforcing feature is not shipped yet (ADR-021): a toggle
// here has no runtime effect until the feature lands, so we flag it for admins.
const PENDING_PERMISSIONS: ReadonlySet<PermissionKey> = new Set(["flow:advanced_config"]);

export function AdminRolesContent() {
  const utils = trpc.useUtils();
  const rolesQuery = trpc.role.list.useQuery();
  const updatePermissions = trpc.role.updatePermissions.useMutation({
    onSuccess: () => void utils.role.list.invalidate(),
  });

  const togglePermission = (
    roleId: string,
    current: PermissionKey[],
    key: PermissionKey,
    granted: boolean,
  ): void => {
    const next = granted ? current.filter((k) => k !== key) : [...current, key];
    updatePermissions.mutate({ roleId, keys: next });
  };

  const assignableRoles = (rolesQuery.data ?? []).filter(
    (entry) => !entry.role.isDefault && !entry.role.isImmutable,
  );

  return (
    <div className="h-full overflow-auto">
      <div className="container space-y-8 py-8">
        <RolesManagementCard />

        <Card>
          <CardHeader>
            <CardTitle>Permissions</CardTitle>
          </CardHeader>
          <CardContent>
            {rolesQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Permission</TableHead>
                    {rolesQuery.data?.map((entry) => (
                      <TableHead key={entry.role.id} className="text-center">
                        {entry.role.name}
                        {entry.role.isImmutable && (
                          <Badge variant="outline" className="ml-1">
                            locked
                          </Badge>
                        )}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {PERMISSIONS.map((permission) => (
                    <TableRow key={permission.key}>
                      <TableCell>
                        <div className="font-medium">
                          {permission.label}
                          {PENDING_PERMISSIONS.has(permission.key) && (
                            <Badge variant="outline" className="ml-2 font-normal text-[#c17a1a]">
                              feature not enabled yet
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {permission.description}
                        </div>
                      </TableCell>
                      {rolesQuery.data?.map((entry) => {
                        const granted = entry.permissions.includes(permission.key);
                        const locked = entry.role.isImmutable;
                        return (
                          <TableCell key={entry.role.id} className="text-center">
                            <input
                              type="checkbox"
                              checked={granted}
                              disabled={locked || updatePermissions.isPending}
                              onChange={() =>
                                togglePermission(
                                  entry.role.id,
                                  entry.permissions,
                                  permission.key,
                                  granted,
                                )
                              }
                            />
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <FeatureAccessCard />

        {assignableRoles.map((entry) => (
          <RoleMembershipPanel key={entry.role.id} roleId={entry.role.id} roleName={entry.role.name} />
        ))}
      </div>
    </div>
  );
}

function RolesManagementCard() {
  const utils = trpc.useUtils();
  const rolesQuery = trpc.role.list.useQuery();
  const [newRoleName, setNewRoleName] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  const refresh = () => Promise.all([utils.role.list.invalidate(), utils.featureFlag.list.invalidate()]);

  const createRole = trpc.role.create.useMutation({
    onSuccess: async () => {
      toast.success("Role created");
      setNewRoleName("");
      await refresh();
    },
    onError: (error) => toast.error(error.message ?? "Failed to create role"),
  });
  const renameRole = trpc.role.rename.useMutation({
    onSuccess: async () => {
      toast.success("Role renamed");
      setRenaming(null);
      await refresh();
    },
    onError: (error) => toast.error(error.message ?? "Failed to rename role"),
  });
  const deleteRole = trpc.role.delete.useMutation({
    onSuccess: async () => {
      toast.success("Role deleted");
      await refresh();
    },
    onError: (error) => toast.error(error.message ?? "Failed to delete role"),
  });

  const handleCreate = () => {
    if (!newRoleName.trim()) return;
    createRole.mutate({ name: newRoleName.trim() });
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Roles</CardTitle>
        <div className="flex gap-2">
          <Input
            placeholder="New role name"
            value={newRoleName}
            onChange={(event) => setNewRoleName(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && handleCreate()}
            className="max-w-[220px]"
          />
          <Button onClick={handleCreate} disabled={createRole.isPending || !newRoleName.trim()}>
            Add role
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {rolesQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <ul className="divide-y divide-[#ece9e3]">
            {rolesQuery.data?.map((entry) => {
              const role = entry.role;
              const canRename = !role.isImmutable;
              const canDelete = !role.isSystem && !role.isImmutable && !role.isDefault;
              return (
                <li key={role.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-[#1a1814]">{role.name}</span>
                      {role.isDefault && <Badge variant="outline">default</Badge>}
                      {role.isImmutable && <Badge variant="outline">locked</Badge>}
                      {role.isSystem && !role.isImmutable && !role.isDefault && (
                        <Badge variant="outline">system</Badge>
                      )}
                      {!role.isSystem && <Badge variant="outline">custom</Badge>}
                    </div>
                    {role.description && (
                      <p className="text-xs text-muted-foreground">{role.description}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {canRename && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setRenaming({ id: role.id, name: role.name })}
                      >
                        Rename
                      </Button>
                    )}
                    {canDelete && (
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={deleteRole.isPending}
                        onClick={() => deleteRole.mutate({ roleId: role.id })}
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      <Dialog open={renaming !== null} onOpenChange={(open) => !open && setRenaming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename role</DialogTitle>
          </DialogHeader>
          {renaming && (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (!renaming.name.trim()) return;
                renameRole.mutate({ roleId: renaming.id, name: renaming.name.trim() });
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="role-name">Name</Label>
                <Input
                  id="role-name"
                  value={renaming.name}
                  onChange={(event) => setRenaming({ ...renaming, name: event.target.value })}
                  autoFocus
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setRenaming(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={renameRole.isPending || !renaming.name.trim()}>
                  Save
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function FeatureAccessCard() {
  const utils = trpc.useUtils();
  const flagsQuery = trpc.featureFlag.list.useQuery();
  const rolesQuery = trpc.role.list.useQuery();
  const setRoles = trpc.featureFlag.setRoles.useMutation({
    onSuccess: () => void utils.featureFlag.list.invalidate(),
  });

  // Empty allowlist ⇒ everyone (ADR-022). Admins always pass, so only offer
  // assignable roles (non-default, non-immutable) as scoping targets.
  const scopableRoles = (rolesQuery.data ?? [])
    .filter((entry) => !entry.role.isDefault && !entry.role.isImmutable)
    .map((entry) => entry.role);

  const toggleRole = (flagKey: string, roleIds: string[], roleId: string): void => {
    const next = roleIds.includes(roleId)
      ? roleIds.filter((id) => id !== roleId)
      : [...roleIds, roleId];
    setRoles.mutate({ key: flagKey, roleIds: next });
  };

  const flags = flagsQuery.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Feature access</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Grant access to each enabled feature by role. Leave every role unchecked to allow
          everyone. Admins always have access. Enable or create features under{" "}
          <span className="font-medium">Advanced → Flags</span>.
        </p>
        {flagsQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : flags.length === 0 ? (
          <p className="text-sm text-muted-foreground">No features defined yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Feature</TableHead>
                <TableHead className="text-center">Status</TableHead>
                {scopableRoles.map((role) => (
                  <TableHead key={role.id} className="text-center">
                    {role.name}
                  </TableHead>
                ))}
                <TableHead className="text-center">Everyone</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {flags.map((flag) => (
                <TableRow key={flag.id}>
                  <TableCell className="font-mono text-xs">{flag.key}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant={flag.enabled ? "default" : "outline"}>
                      {flag.enabled ? "on" : "off"}
                    </Badge>
                  </TableCell>
                  {scopableRoles.map((role) => (
                    <TableCell key={role.id} className="text-center">
                      <input
                        type="checkbox"
                        checked={flag.roleIds.includes(role.id)}
                        disabled={!flag.enabled || setRoles.isPending}
                        onChange={() => toggleRole(flag.key, flag.roleIds, role.id)}
                      />
                    </TableCell>
                  ))}
                  <TableCell className="text-center text-xs text-muted-foreground">
                    {flag.enabled && flag.roleIds.length === 0 ? "✓" : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function RoleMembershipPanel({ roleId, roleName }: { roleId: string; roleName: string }) {
  const utils = trpc.useUtils();
  const usersQuery = trpc.user.list.useQuery({});
  const membersQuery = trpc.role.listUsers.useQuery({ roleId });
  const [selectedUserId, setSelectedUserId] = useState("");

  const assign = trpc.role.assignUser.useMutation({
    onSuccess: () => void utils.role.listUsers.invalidate({ roleId }),
  });
  const remove = trpc.role.removeUser.useMutation({
    onSuccess: () => void utils.role.listUsers.invalidate({ roleId }),
  });

  const memberIds = new Set(membersQuery.data ?? []);
  const users = usersQuery.data ?? [];
  const members = users.filter((user) => memberIds.has(user.id));
  const nonMembers = users.filter((user) => !memberIds.has(user.id) && !user.isAdmin);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{roleName} — Members</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <select
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
            disabled={!selectedUserId || assign.isPending}
            onClick={() => {
              if (!selectedUserId) return;
              assign.mutate({ userId: selectedUserId, roleId });
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
            {members.map((user) => (
              <li key={user.id} className="flex items-center justify-between">
                <span className="font-mono text-xs">{user.email}</span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate({ userId: user.id, roleId })}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
