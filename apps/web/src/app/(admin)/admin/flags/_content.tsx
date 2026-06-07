"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/trpc/client";

export function AdminFlagsContent() {
  const utils = trpc.useUtils();
  const flagsQuery = trpc.featureFlag.list.useQuery();
  const rolesQuery = trpc.role.list.useQuery();
  const upsert = trpc.featureFlag.upsert.useMutation({
    onSuccess: () => void utils.featureFlag.list.invalidate(),
  });
  const setRoles = trpc.featureFlag.setRoles.useMutation({
    onSuccess: () => void utils.featureFlag.list.invalidate(),
  });

  const [newKey, setNewKey] = useState("");

  const toggle = (key: string, enabled: boolean, rolloutPct: number) =>
    upsert.mutate({ key, enabled: !enabled, rolloutPct });

  const create = () => {
    if (!newKey.trim()) return;
    upsert.mutate({ key: newKey.trim(), enabled: false, rolloutPct: 100 });
    setNewKey("");
  };

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

  return (
    <div className="h-full overflow-auto">
    <div className="container py-8">
    <Card>
      <CardHeader>
        <CardTitle>Feature Flags</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder="new-flag-key"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            className="max-w-xs"
          />
          <Button onClick={create} disabled={upsert.isPending}>
            Add flag
          </Button>
        </div>

        {flagsQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Key</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Limit to roles</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {flagsQuery.data?.map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="font-mono text-xs">{f.key}</TableCell>
                  <TableCell>
                    <button
                      onClick={() => toggle(f.key, f.enabled, f.rolloutPct)}
                      disabled={upsert.isPending}
                    >
                      <Badge variant={f.enabled ? "default" : "outline"}>
                        {f.enabled ? "on" : "off"}
                      </Badge>
                    </button>
                  </TableCell>
                  <TableCell className="text-sm">
                    {!f.enabled ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {f.roleIds.length === 0 && (
                          <span className="text-xs text-muted-foreground">Everyone</span>
                        )}
                        {scopableRoles.map((role) => (
                          <label key={role.id} className="flex items-center gap-2 text-xs">
                            <input
                              type="checkbox"
                              checked={f.roleIds.includes(role.id)}
                              disabled={setRoles.isPending}
                              onChange={() => toggleRole(f.key, f.roleIds, role.id)}
                            />
                            {role.name}
                          </label>
                        ))}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {f.description ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(f.updatedAt).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
    </div>
    </div>
  );
}
