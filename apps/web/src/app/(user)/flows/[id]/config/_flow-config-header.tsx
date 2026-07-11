"use client";

import Link from "next/link";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FlowVersionIndicator } from "@/components/canvas/flow-version-indicator";
import type { trpc } from "@/trpc/client";

type UpdateFlowMutation = ReturnType<typeof trpc.flow.update.useMutation>;

// The header bar + flow-actions menu for the owner (user-facing) flow-config
// screen. Purely presentational: every mutation and piece of canvas state is
// threaded in from CanvasInner, so the menu's publish/visibility/delete actions
// keep their exact prior behaviour.
export function FlowConfigHeader({
  flowId,
  flowName,
  flowStatus,
  setFlowStatus,
  flowVisibility,
  setFlowVisibility,
  hasUnpublishedChanges,
  setHasUnpublishedChanges,
  latestPublishedNumber,
  canPublishToEveryone,
  flowMenuOpen,
  setFlowMenuOpen,
  flowMenuRef,
  onAddStep,
  updateFlowMutation,
  refetchVersionStatus,
  setEditingMetadata,
  setVersionHistoryOpen,
  setDeleteConfirmOpen,
}: {
  flowId: string;
  flowName: string;
  flowStatus: "draft" | "published";
  setFlowStatus: Dispatch<SetStateAction<"draft" | "published">>;
  flowVisibility: "private" | "global";
  setFlowVisibility: Dispatch<SetStateAction<"private" | "global">>;
  hasUnpublishedChanges: boolean;
  setHasUnpublishedChanges: Dispatch<SetStateAction<boolean>>;
  latestPublishedNumber: number | null;
  canPublishToEveryone: boolean;
  flowMenuOpen: boolean;
  setFlowMenuOpen: Dispatch<SetStateAction<boolean>>;
  flowMenuRef: RefObject<HTMLDivElement | null>;
  onAddStep: () => void;
  updateFlowMutation: UpdateFlowMutation;
  refetchVersionStatus: () => void;
  setEditingMetadata: Dispatch<SetStateAction<boolean>>;
  setVersionHistoryOpen: Dispatch<SetStateAction<boolean>>;
  setDeleteConfirmOpen: Dispatch<SetStateAction<boolean>>;
}) {
  return (
    <div className="flex items-center gap-3 border-b bg-white px-4 py-3 pr-14 shrink-0">
      <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">← Home</Link>
      <div className="h-4 w-px bg-border" />
      <span className="text-sm font-semibold">{flowName}</span>
      <FlowVersionIndicator
        hasUnpublishedChanges={hasUnpublishedChanges}
        latestPublishedNumber={latestPublishedNumber}
      />
      <Badge variant={flowStatus === "published" ? "default" : "secondary"}>
        {flowStatus === "published"
          ? `Published · ${flowVisibility === "global" ? "Everyone" : "Only you"}`
          : "Draft"}
      </Badge>
      <div className="ml-auto flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={onAddStep}>
          + Add step
        </Button>
        <div className="relative" ref={flowMenuRef}>
          <Button
            size="sm"
            variant="outline"
            aria-label="Flow actions"
            onClick={() => setFlowMenuOpen((prev) => !prev)}
            className="px-2"
          >
            <MoreHorizontal size={16} />
          </Button>
          {flowMenuOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-[9px] border border-[#dedad2] bg-white py-1 shadow-md">
              {flowStatus === "published" ? (
                <>
                  {hasUnpublishedChanges && (
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left text-[13px] text-[#1a1814] hover:bg-[#efede8]"
                      onClick={() => {
                        setFlowMenuOpen(false);
                        setHasUnpublishedChanges(false);
                        void updateFlowMutation
                          .mutateAsync({ flowId, status: "published" })
                          .then(() => {
                            toast.success("New version published");
                            refetchVersionStatus();
                          });
                      }}
                    >
                      Publish new version
                    </button>
                  )}
                  <button
                    type="button"
                    className="w-full px-3 py-2 text-left text-[13px] text-[#1a1814] hover:bg-[#efede8]"
                    onClick={() => {
                      setFlowMenuOpen(false);
                      setFlowStatus("draft");
                      void updateFlowMutation.mutateAsync({ flowId, status: "draft" }).then(() => {
                        toast.success("Flow unpublished");
                      });
                    }}
                  >
                    Unpublish
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left text-[13px] text-[#1a1814] hover:bg-[#efede8]"
                  onClick={() => {
                    setFlowMenuOpen(false);
                    setFlowStatus("published");
                    setFlowVisibility("private");
                    void updateFlowMutation
                      .mutateAsync({
                        flowId,
                        status: "published",
                        visibility: { kind: "private" },
                      })
                      .then(() => toast.success("Flow published privately"));
                  }}
                >
                  Publish privately (only you)
                </button>
              )}
              {flowStatus !== "published" && canPublishToEveryone && (
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left text-[13px] text-[#1a1814] hover:bg-[#efede8]"
                  onClick={() => {
                    setFlowMenuOpen(false);
                    setFlowStatus("published");
                    setFlowVisibility("global");
                    void updateFlowMutation
                      .mutateAsync({
                        flowId,
                        status: "published",
                        visibility: { kind: "global" },
                      })
                      .then(() => toast.success("Flow published globally"));
                  }}
                >
                  Publish globally (everyone)
                </button>
              )}
              {flowStatus === "published" && canPublishToEveryone && flowVisibility === "private" && (
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left text-[13px] text-[#1a1814] hover:bg-[#efede8]"
                  onClick={() => {
                    setFlowMenuOpen(false);
                    setFlowVisibility("global");
                    void updateFlowMutation
                      .mutateAsync({ flowId, visibility: { kind: "global" } })
                      .then(() => toast.success("Flow is now visible to everyone"));
                  }}
                >
                  Make global (everyone)
                </button>
              )}
              {flowStatus === "published" && canPublishToEveryone && flowVisibility === "global" && (
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left text-[13px] text-[#1a1814] hover:bg-[#efede8]"
                  onClick={() => {
                    setFlowMenuOpen(false);
                    setFlowVisibility("private");
                    void updateFlowMutation
                      .mutateAsync({ flowId, visibility: { kind: "private" } })
                      .then(() => toast.success("Flow is now private"));
                  }}
                >
                  Make private (only you)
                </button>
              )}
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-[13px] text-[#1a1814] hover:bg-[#efede8]"
                onClick={() => {
                  setFlowMenuOpen(false);
                  setEditingMetadata(true);
                }}
              >
                Edit
              </button>
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-[13px] text-[#1a1814] hover:bg-[#efede8]"
                onClick={() => {
                  setFlowMenuOpen(false);
                  setVersionHistoryOpen(true);
                }}
              >
                Version history
              </button>
              <div className="my-1 border-t border-[#dedad2]" />
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-[13px] text-[#c2385a] hover:bg-[#fdf3f5]"
                onClick={() => {
                  setFlowMenuOpen(false);
                  setDeleteConfirmOpen(true);
                }}
              >
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
