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
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { TableSkeletonRows } from "@/components/skeleton/card-skeleton";
import { FlowMetadataDialog, type FlowMetadataValues } from "@/components/flow/flow-metadata-dialog";
import { ShareFlowDialog } from "@/components/flow/share-flow-dialog";
import { trpc } from "@/trpc/client";

interface AssignOwnerState {
  flowId: string;
  userId: string;
}

interface EditState {
  flowId: string;
  initial: Partial<FlowMetadataValues>;
}

export function AdminFlowsContent() {
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

  const updateMutation = trpc.flow.update.useMutation({
    onSuccess: () => {
      void utils.flow.list.invalidate();
      setEditing(null);
      toast.success("Flow updated");
    },
  });

  const grantOwnerMutation = trpc.flow.grantOwner.useMutation({
    onSuccess: () => {
      void utils.flow.list.invalidate();
      setAssignOwner(null);
    },
  });

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [sharing, setSharing] = useState<{ flowId: string; name: string } | null>(null);
  const [assignOwner, setAssignOwner] = useState<AssignOwnerState | null>(null);

  const handleCreate = (values: FlowMetadataValues) => {
    void createMutation.mutateAsync({
      name: values.name,
      expertRole: values.expertRole,
      description: values.description || null,
      icon: values.icon || null,
    });
  };

  const handleEdit = (values: FlowMetadataValues) => {
    if (!editing) return;
    void updateMutation.mutateAsync({
      flowId: editing.flowId,
      name: values.name,
      expertRole: values.expertRole,
      description: values.description || null,
      icon: values.icon || null,
    });
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
    <div className="h-full overflow-auto">
      <div className="container py-8">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Flows</CardTitle>
            <Button onClick={() => setCreating(true)}>New Flow</Button>
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
                onCta={() => setCreating(true)}
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
                      <TableCell className="max-w-xs truncate text-[#6d6a65]">
                        {flow.description ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={flow.status === "published" ? "green" : "grey"}>
                          {flow.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#eef1fc] text-xs font-medium text-[#3a5fd9]">
                            {getOwnerInitials(flow)}
                          </span>
                          <span className="text-[13px]">{getOwnerName(flow)}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-[13px] text-[#6d6a65]">
                        {new Date(flow.updatedAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="space-x-2 text-right">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setAssignOwner({ flowId: flow.id, userId: flow.ownerUserId })}
                        >
                          Assign owner
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setEditing({
                              flowId: flow.id,
                              initial: {
                                name: flow.name,
                                expertRole: flow.expertRole ?? "",
                                description: flow.description ?? "",
                                icon: flow.icon ?? "🗂️",
                              },
                            })
                          }
                        >
                          Edit
                        </Button>
                        {flow.status === "published" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setSharing({ flowId: flow.id, name: flow.name })}
                          >
                            Share
                          </Button>
                        )}
                        <Button size="sm" asChild>
                          <Link href={`/flows/${flow.id}/config`}>Configure Flow</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>

          <FlowMetadataDialog
            open={creating}
            mode="create"
            isSaving={createMutation.isPending}
            onSubmit={handleCreate}
            onClose={() => setCreating(false)}
          />

          <FlowMetadataDialog
            open={editing !== null}
            mode="edit"
            initialValues={editing?.initial}
            isSaving={updateMutation.isPending}
            onSubmit={handleEdit}
            onClose={() => setEditing(null)}
          />

          {sharing && (
            <ShareFlowDialog
              open={true}
              flowId={sharing.flowId}
              flowName={sharing.name}
              onClose={() => setSharing(null)}
            />
          )}

          <Dialog open={assignOwner !== null} onOpenChange={(o) => !o && setAssignOwner(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Assign flow owner</DialogTitle>
                <DialogCloseButton />
              </DialogHeader>
              <DialogBody>
                {assignOwner && (
                  <div className="space-y-1">
                    <Label htmlFor="owner-select">Select user</Label>
                    <select
                      id="owner-select"
                      className="flex h-10 w-full rounded-[9px] border border-[#dedad2] bg-[#f7f6f3] px-3 py-2 text-[13px] text-[#1a1814] focus:border-[#3a5fd9] focus:bg-white focus:outline-none"
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
              </DialogBody>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setAssignOwner(null)}>Cancel</Button>
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
      </div>
    </div>
  );
}
