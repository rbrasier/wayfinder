"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { TableSkeletonRows } from "@/components/skeleton/card-skeleton";
import { FlowMetadataDialog, type FlowMetadataValues } from "@/components/flow/flow-metadata-dialog";
import { ShareFlowDialog } from "@/components/flow/share-flow-dialog";
import { AppHeader } from "@/components/layout/app-header";
import { BusyOverlay } from "@/components/ui/busy-overlay";
import { useNavigationBusy } from "@/lib/use-navigation-busy";
import { NEW_FLOW_CALLOUT_ID, NewFlowStepCallout } from "@/components/tour/new-flow-step-callout";
import { parseTourStage, TOUR_PARAM, withTourStage } from "@/components/tour/tour-stage";
import { usePermissions } from "@/lib/use-permissions";
import { trpc } from "@/trpc/client";

interface EditState {
  flowId: string;
  initial: Partial<FlowMetadataValues>;
}

export function UserFlowsContent() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const permissions = usePermissions();
  const canCreate = permissions.has("workflow:create_own");
  const flowsQuery = trpc.flow.listMine.useQuery();
  // The welcome tour arrives here with the dialog already asked for, and hands
  // the person on to the canvas with the explainer stage set (ADR-056 §2).
  const searchParams = useSearchParams();
  const guidedByTour = parseTourStage(searchParams.get(TOUR_PARAM)) === "new-flow";
  // The config canvas is a heavy, server-rendered page with no loading skeleton
  // of its own, so without this the list sits there looking unclicked.
  const busy = useNavigationBusy();

  // A new flow is empty, so the only useful next step is laying out its steps —
  // go straight to the canvas rather than back to the list.
  const createMutation = trpc.flow.create.useMutation({
    onSuccess: (flow) => {
      void utils.flow.listMine.invalidate();
      setCreating(false);
      toast.success("Flow created");
      const canvasPath = `/flows/${flow.id}/config`;
      router.push(guidedByTour ? withTourStage(canvasPath, "flow-explainer") : canvasPath);
    },
    onError: (error) => {
      busy.stop();
      toast.error(error.message);
    },
  });

  const updateMutation = trpc.flow.update.useMutation({
    onSuccess: () => {
      void utils.flow.listMine.invalidate();
      setEditing(null);
      toast.success("Flow updated");
    },
  });

  const [creating, setCreating] = useState(guidedByTour);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [sharing, setSharing] = useState<{ flowId: string; name: string } | null>(null);

  const handleCreate = (values: FlowMetadataValues) => {
    busy.start();
    void createMutation.mutateAsync({
      name: values.name,
      expertRole: values.expertRole,
      description: values.description || null,
      icon: values.icon || null,
    });
  };

  const closeCreate = () => {
    setCreating(false);
    // Backing out of the guided dialog ends this leg of the tour; the person can
    // still create a flow normally, without the callout.
    if (guidedByTour) router.replace("/flows");
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
    <div className="flex h-full flex-col overflow-hidden">
      {busy.busy && <BusyOverlay label="Opening the flow builder…" />}
      <AppHeader
        title="Flows"
        actions={
          canCreate ? (
            <Button size="sm" onClick={() => setCreating(true)}>
              New flow
            </Button>
          ) : undefined
        }
      />

      <div className="flex-1 overflow-auto">
        <div className="container py-8">
        <Card>
          <CardContent className="pt-6">
            {flowsQuery.isPending ? (
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
                      <TableCell className="max-w-xs truncate text-[#666055]">
                        {flow.description ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={flow.status === "published" ? "green" : "grey"}>
                          {flow.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-[13px] text-[#666055]">
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
                          <Link href={`/flows/${flow.id}/config`} onClick={busy.start}>
                            Configure Flow
                          </Link>
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
            onClose={closeCreate}
            guide={guidedByTour && canCreate ? <NewFlowStepCallout /> : undefined}
            guideId={NEW_FLOW_CALLOUT_ID}
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
    </div>
  );
}
