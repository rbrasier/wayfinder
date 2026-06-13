"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { trpc } from "@/trpc/client";

interface VersionHistoryDialogProps {
  flowId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Lets the canvas refetch after a restore rewrites the live definition.
  onRestored?: () => void;
}

const formatDate = (value: string | Date | null): string => {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
};

export function VersionHistoryDialog({
  flowId,
  open,
  onOpenChange,
  onRestored,
}: VersionHistoryDialogProps) {
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);

  const listQuery = trpc.flowVersion.list.useQuery({ flowId }, { enabled: open });
  const detailQuery = trpc.flowVersion.get.useQuery(
    { versionId: selectedVersionId ?? "" },
    { enabled: open && Boolean(selectedVersionId) },
  );
  const restoreMutation = trpc.flowVersion.restore.useMutation();

  const handleRestore = (versionId: string, versionNumber: number | null) => {
    restoreMutation.mutate(
      { versionId },
      {
        onSuccess: () => {
          toast.success(`Restored from version ${versionNumber ?? "?"}`);
          void listQuery.refetch();
          onRestored?.();
        },
        onError: (error) => toast.error(error.message),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Version history</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>
        <DialogBody>
          {listQuery.isLoading && <p className="text-[13px] text-[#5a5650]">Loading history…</p>}
          {listQuery.data?.length === 0 && (
            <p className="text-[13px] text-[#5a5650]">
              No versions yet. Publishing this flow records its first version.
            </p>
          )}

          <ul className="flex flex-col divide-y divide-[#dedad2]">
            {listQuery.data?.map((version) => {
              const isSelected = version.id === selectedVersionId;
              return (
                <li key={version.id} className="py-3">
                  <div className="flex items-center gap-3">
                    <span className="text-[13px] font-semibold text-[#1a1814]">
                      {version.versionNumber === null ? "Draft" : `Version ${version.versionNumber}`}
                    </span>
                    <Badge variant={version.status === "published" ? "default" : "secondary"}>
                      {version.status}
                    </Badge>
                    <span className="text-[12px] text-[#5a5650]">{formatDate(version.publishedAt)}</span>
                    <div className="ml-auto flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSelectedVersionId(isSelected ? null : version.id)}
                      >
                        {isSelected ? "Hide" : "View"}
                      </Button>
                      {version.status === "published" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={restoreMutation.isPending}
                          onClick={() => handleRestore(version.id, version.versionNumber)}
                        >
                          Restore
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 text-[12px] text-[#5a5650]">
                    {version.publishedByName && <span>by {version.publishedByName}</span>}
                    {version.changeSummary && <span>· {version.changeSummary}</span>}
                  </div>

                  {isSelected && (
                    <div className="mt-3 rounded-[10px] border border-[#dedad2] bg-[#faf9f6] p-3">
                      {detailQuery.isLoading && (
                        <p className="text-[12px] text-[#5a5650]">Loading snapshot…</p>
                      )}
                      {detailQuery.data && (
                        <div className="flex flex-col gap-2 text-[12px] text-[#1a1814]">
                          <p className="font-semibold">{detailQuery.data.snapshot.flow.name}</p>
                          <p className="text-[#5a5650]">
                            {detailQuery.data.snapshot.nodes.length} step(s),{" "}
                            {detailQuery.data.snapshot.edges.length} connection(s)
                          </p>
                          <ul className="flex flex-col gap-1">
                            {detailQuery.data.snapshot.nodes.map((node) => (
                              <li key={node.id} className="flex items-center gap-2">
                                <span className="rounded-[6px] bg-[#efede8] px-1.5 py-0.5 text-[11px]">
                                  {node.type}
                                </span>
                                <span>{node.name || "Untitled step"}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
