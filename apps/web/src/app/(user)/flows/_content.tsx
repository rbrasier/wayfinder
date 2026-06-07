"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { TableSkeletonRows } from "@/components/skeleton/card-skeleton";
import { FlowMetadataDialog, type FlowMetadataValues } from "@/components/flow/flow-metadata-dialog";
import { ShareFlowDialog } from "@/components/flow/share-flow-dialog";
import { usePermissions } from "@/lib/use-permissions";
import { trpc } from "@/trpc/client";

interface EditState {
  flowId: string;
  initial: Partial<FlowMetadataValues>;
}

export function UserFlowsContent() {
  const utils = trpc.useUtils();
  const permissions = usePermissions();
  const canCreate = permissions.has("workflow:create_own");
  const flowsQuery = trpc.flow.listMine.useQuery();

  const createMutation = trpc.flow.create.useMutation({
    onSuccess: () => {
      void utils.flow.listMine.invalidate();
      setCreating(false);
      toast.success("Flow created");
    },
  });

  const updateMutation = trpc.flow.update.useMutation({
    onSuccess: () => {
      void utils.flow.listMine.invalidate();
      setEditing(null);
      toast.success("Flow updated");
    },
  });

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [sharing, setSharing] = useState<{ flowId: string; name: string } | null>(null);

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

  return (
    <div className="h-full overflow-auto">
      <div className="container py-8">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Flows</CardTitle>
            {canCreate && <Button onClick={() => setCreating(true)}>New Flow</Button>}
          </CardHeader>
          <CardContent>
            {flowsQuery.isLoading ? (
              <TableSkeletonRows count={4} />
            ) : !flowsQuery.data?.length ? (
              <EmptyState
                icon="🗂️"
                heading="No flows yet"
                body="Create a flow to define a guided workflow."
                ctaLabel={canCreate ? "New Flow" : undefined}
                onCta={canCreate ? () => setCreating(true) : undefined}
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Status</TableHead>
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
                      <TableCell className="max-w-xs truncate text-[#918d87]">
                        {flow.description ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={flow.status === "published" ? "green" : "grey"}>
                          {flow.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-[13px] text-[#918d87]">
                        {new Date(flow.updatedAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="space-x-2 text-right">
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
        </Card>
      </div>
    </div>
  );
}
