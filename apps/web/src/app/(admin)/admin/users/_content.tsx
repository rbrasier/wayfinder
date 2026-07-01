"use client";

import type { User } from "@rbrasier/domain";
import { useState } from "react";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { trpc } from "@/trpc/client";

interface FormState {
  id?: string;
  email: string;
  name: string;
  isAdmin: boolean;
}

const empty: FormState = { email: "", name: "", isAdmin: false };

export function AdminUsersContent() {
  const utils = trpc.useUtils();
  const usersQuery = trpc.user.list.useQuery({});
  const rolesQuery = trpc.role.list.useQuery();
  const powerUsersRole = (rolesQuery.data ?? []).find(
    (entry) => entry.role.key === "power_users",
  )?.role;
  const powerUsersRoleId = powerUsersRole?.id ?? "";
  const membersQuery = trpc.role.listUsers.useQuery(
    { roleId: powerUsersRoleId },
    { enabled: powerUsersRoleId !== "" },
  );
  const assignRole = trpc.role.assignUser.useMutation({
    onSuccess: () => void utils.role.listUsers.invalidate({ roleId: powerUsersRoleId }),
  });
  const removeRole = trpc.role.removeUser.useMutation({
    onSuccess: () => void utils.role.listUsers.invalidate({ roleId: powerUsersRoleId }),
  });
  const powerUserIds = new Set(membersQuery.data ?? []);

  const togglePowerUser = (userId: string, isMember: boolean): void => {
    if (!powerUsersRoleId) return;
    if (isMember) {
      removeRole.mutate({ userId, roleId: powerUsersRoleId });
    } else {
      assignRole.mutate({ userId, roleId: powerUsersRoleId });
    }
  };
  const createMutation = trpc.user.create.useMutation({
    onSuccess: () => utils.user.list.invalidate(),
  });
  const updateMutation = trpc.user.update.useMutation({
    onSuccess: () => utils.user.list.invalidate(),
  });
  const deleteMutation = trpc.user.delete.useMutation({
    onSuccess: () => utils.user.list.invalidate(),
  });

  const [editing, setEditing] = useState<FormState | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<User | null>(null);

  const onSubmit = async (form: FormState): Promise<void> => {
    if (form.id) {
      await updateMutation.mutateAsync({
        id: form.id,
        email: form.email,
        name: form.name || null,
        isAdmin: form.isAdmin,
      });
    } else {
      await createMutation.mutateAsync({
        email: form.email,
        name: form.name || null,
        isAdmin: form.isAdmin,
      });
    }
    setEditing(null);
  };

  return (
    <div className="h-full overflow-auto">
    <div className="container py-8">
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Users</CardTitle>
        <Button onClick={() => setEditing({ ...empty })}>Add user</Button>
      </CardHeader>
      <CardContent>
        {usersQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Admin</TableHead>
                <TableHead>Power User</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usersQuery.data?.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>{u.name ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{u.email}</TableCell>
                  <TableCell>
                    {u.isAdmin && <Badge>admin</Badge>}
                  </TableCell>
                  <TableCell>
                    <input
                      type="checkbox"
                      aria-label={`Power user: ${u.name ?? u.email}`}
                      checked={u.isAdmin || powerUserIds.has(u.id)}
                      disabled={
                        u.isAdmin ||
                        !powerUsersRoleId ||
                        assignRole.isPending ||
                        removeRole.isPending
                      }
                      onChange={() => togglePowerUser(u.id, powerUserIds.has(u.id))}
                    />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(u.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="space-x-2 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setEditing({
                          id: u.id,
                          email: u.email,
                          name: u.name ?? "",
                          isAdmin: u.isAdmin,
                        })
                      }
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => setConfirmDelete(u)}
                    >
                      Delete
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit user" : "Add user"}</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          {editing && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void onSubmit(editing);
              }}
            >
              <DialogBody>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    value={editing.email}
                    onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={editing.isAdmin}
                    onChange={(e) => setEditing({ ...editing, isAdmin: e.target.checked })}
                  />
                  Admin
                </label>
              </DialogBody>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button type="submit">Save</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDelete !== null} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete user?</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody>
            <p className="text-sm text-muted-foreground">
              This will permanently remove <strong>{confirmDelete?.email}</strong>.
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!confirmDelete) return;
                await deleteMutation.mutateAsync({ id: confirmDelete.id });
                setConfirmDelete(null);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
    </div>
    </div>
  );
}
