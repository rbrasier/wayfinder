"use client";

import { PERMISSIONS, type PermissionKey } from "@rbrasier/domain";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/trpc/client";

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
        <Card>
          <CardHeader>
            <CardTitle>Roles &amp; Permissions</CardTitle>
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
                        <div className="font-medium">{permission.label}</div>
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

        {assignableRoles.map((entry) => (
          <RoleMembershipPanel key={entry.role.id} roleId={entry.role.id} roleName={entry.role.name} />
        ))}
      </div>
    </div>
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
