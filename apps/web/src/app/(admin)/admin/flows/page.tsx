"use client";

import type { Flow } from "@rbrasier/domain";
import Link from "next/link";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { TableSkeletonRows } from "@/components/skeleton/card-skeleton";
import { trpc } from "@/trpc/client";

const ICONS = ["🗂️", "🏗️", "💬", "📋", "🔄", "⚙️"];

interface NewFlowForm {
  name: string;
  description: string;
  icon: string;
}

interface AssignOwnerState {
  flowId: string;
  userId: string;
}

const emptyForm = (): NewFlowForm => ({ name: "", description: "", icon: ICONS[0] ?? "🗂️" });

export default function AdminFlowsPage() {
  const utils = trpc.useUtils();
  const flowsQuery = trpc.flow.list.useQuery();
  const usersQuery = trpc.user.list.useQuery({});

  const createMutation = trpc.flow.create.useMutation({
    onSuccess: () => {
      void utils.flow.list.invalidate();
      setCreating(false);
      toast.success("Flow created");
    },
  });

  const grantOwnerMutation = trpc.flow.grantOwner.useMutation({
    onSuccess: () => {
      void utils.flow.list.invalidate();
      setAssignOwner(null);
    },
  });

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<NewFlowForm>(emptyForm());
  const [assignOwner, setAssignOwner] = useState<AssignOwnerState | null>(null);

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    await createMutation.mutateAsync({
      name: form.name.trim(),
      description: form.description.trim() || null,
      icon: form.icon || null,
    });
    setForm(emptyForm());
  };

  const handleAssignOwner = async () => {
    if (!assignOwner?.userId) return;
    await grantOwnerMutation.mutateAsync(assignOwner);
  };

  const getOwnerName = (flow: Flow): string => {
    const user = usersQuery.data?.find((u) => u.id === flow.ownerUserId);
    return user?.name ?? user?.email ?? "Unknown";
  };

  const getOwnerInitials = (flow: Flow): string => {
    const user = usersQuery.data?.find((u) => u.id === flow.ownerUserId);
    const name = user?.name ?? user?.email ?? "?";
    return name.slice(0, 2).toUpperCase();
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Flows</CardTitle>
        <Button onClick={() => { setForm(emptyForm()); setCreating(true); }}>New Flow</Button>
      </CardHeader>
      <CardContent>
        {flowsQuery.isLoading ? (
          <TableSkeletonRows count={4} />
        ) : !flowsQuery.data?.length ? (
          <EmptyState
            icon="🗂️"
            heading="No flows yet"
            body="Create a flow to define the guided workflow your users will follow."
            ctaLabel="New Flow"
            onCta={() => { setForm(emptyForm()); setCreating(true); }}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {flowsQuery.data.map((flow) => (
                <TableRow key={flow.id}>
                  <TableCell className="font-medium">
                    {flow.icon && <span className="mr-1">{flow.icon}</span>}
                    {flow.name}
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-xs truncate">
                    {flow.description ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={flow.status === "published" ? "default" : "secondary"}>
                      {flow.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 text-xs font-medium text-indigo-700">
                        {getOwnerInitials(flow)}
                      </span>
                      <span className="text-sm">{getOwnerName(flow)}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {new Date(flow.updatedAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="space-x-2 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setAssignOwner({ flowId: flow.id, userId: flow.ownerUserId })}
                    >
                      Assign owner
                    </Button>
                    <Button size="sm" asChild>
                      <Link href={`/admin/flows/${flow.id}`}>Edit</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={creating} onOpenChange={(o) => !o && setCreating(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Flow</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="flow-name">Name</Label>
              <Input
                id="flow-name"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Client onboarding"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="flow-desc">Description</Label>
              <Input
                id="flow-desc"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Optional description"
              />
            </div>
            <div className="space-y-2">
              <Label>Icon</Label>
              <div className="flex gap-2">
                {ICONS.map((icon) => (
                  <button
                    key={icon}
                    type="button"
                    className={`flex h-10 w-10 items-center justify-center rounded-md border text-xl transition-colors ${form.icon === icon ? "border-indigo-500 bg-indigo-50" : "border-gray-200 hover:bg-gray-50"}`}
                    onClick={() => setForm({ ...form, icon })}
                  >
                    {icon}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>Cancel</Button>
            <Button
              onClick={handleCreate}
              disabled={createMutation.isPending || !form.name.trim()}
            >
              {createMutation.isPending ? "Creating…" : "Create flow"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={assignOwner !== null} onOpenChange={(o) => !o && setAssignOwner(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign flow owner</DialogTitle>
          </DialogHeader>
          {assignOwner && (
            <div className="space-y-2">
              <Label htmlFor="owner-select">Select user</Label>
              <select
                id="owner-select"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={assignOwner.userId}
                onChange={(e) => setAssignOwner({ ...assignOwner, userId: e.target.value })}
              >
                {usersQuery.data?.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name ?? u.email}
                  </option>
                ))}
              </select>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOwner(null)}>Cancel</Button>
            <Button
              onClick={handleAssignOwner}
              disabled={grantOwnerMutation.isPending || !assignOwner?.userId}
            >
              {grantOwnerMutation.isPending ? "Assigning…" : "Assign owner"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
