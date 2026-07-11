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

// The header bar + flow-actions menu for the admin flow-config screen, including
// the inline rename field. Purely presentational: mutation and canvas state are
// threaded in from CanvasInner so the publish sub-menu and rename keep their
// exact prior behaviour.
export function FlowConfigHeader({
  flowId,
  flowName,
  setFlowName,
  canvasFlowName,
  flowStatus,
  setFlowStatus,
  flowVisibility,
  setFlowVisibility,
  hasUnpublishedChanges,
  setHasUnpublishedChanges,
  latestPublishedNumber,
  editingName,
  setEditingName,
  editNameInputRef,
  actionsMenuOpen,
  setActionsMenuOpen,
  publishSubOpen,
  setPublishSubOpen,
  actionsMenuRef,
  onAddStep,
  updateFlowMutation,
  refetchVersionStatus,
  setVersionHistoryOpen,
}: {
  flowId: string;
  flowName: string;
  setFlowName: Dispatch<SetStateAction<string>>;
  canvasFlowName: string;
  flowStatus: "draft" | "published";
  setFlowStatus: Dispatch<SetStateAction<"draft" | "published">>;
  flowVisibility: "private" | "global";
  setFlowVisibility: Dispatch<SetStateAction<"private" | "global">>;
  hasUnpublishedChanges: boolean;
  setHasUnpublishedChanges: Dispatch<SetStateAction<boolean>>;
  latestPublishedNumber: number | null;
  editingName: boolean;
  setEditingName: Dispatch<SetStateAction<boolean>>;
  editNameInputRef: RefObject<HTMLInputElement | null>;
  actionsMenuOpen: boolean;
  setActionsMenuOpen: Dispatch<SetStateAction<boolean>>;
  publishSubOpen: boolean;
  setPublishSubOpen: Dispatch<SetStateAction<boolean>>;
  actionsMenuRef: RefObject<HTMLDivElement | null>;
  onAddStep: () => void;
  updateFlowMutation: UpdateFlowMutation;
  refetchVersionStatus: () => void;
  setVersionHistoryOpen: Dispatch<SetStateAction<boolean>>;
}) {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b bg-white px-4 py-3 pr-14">
      <Link href="/admin/flows" className="shrink-0 text-[13px] text-[#5a5650] hover:text-[#1a1814]">
        ← Flows
      </Link>
      <div className="h-4 w-px bg-border" />

      {editingName ? (
        <input
          ref={editNameInputRef}
          className="rounded border px-2 py-1 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/30"
          value={flowName}
          onChange={(e) => setFlowName(e.target.value)}
          onBlur={() => {
            setEditingName(false);
            if (flowName.trim()) {
              void updateFlowMutation.mutateAsync({ flowId, name: flowName.trim() }).then(() => {
                toast.success("Flow saved");
              });
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setFlowName(canvasFlowName);
              setEditingName(false);
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="text-[13px] font-semibold text-[#1a1814] hover:text-primary"
          onClick={() => setEditingName(true)}
        >
          {flowName || "Untitled flow"}
        </button>
      )}

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
        <div className="relative" ref={actionsMenuRef}>
          <Button
            size="sm"
            variant="outline"
            aria-label="Flow actions"
            onClick={() => {
              setActionsMenuOpen((prev) => !prev);
              setPublishSubOpen(false);
            }}
            className="px-2"
          >
            <MoreHorizontal size={16} />
          </Button>
          {actionsMenuOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-[9px] border border-[#dedad2] bg-white py-1 shadow-md">
              {publishSubOpen ? (
                <>
                  <button
                    type="button"
                    className="w-full px-3 py-2 text-left text-[13px] text-[#5a5650] hover:bg-[#efede8]"
                    onClick={() => setPublishSubOpen(false)}
                  >
                    ← Back
                  </button>
                  <div className="my-1 border-t border-[#dedad2]" />
                  {flowStatus !== "published" && (
                    <>
                      <button
                        type="button"
                        className="w-full px-3 py-2 text-left text-[13px] text-[#1a1814] hover:bg-[#efede8]"
                        onClick={() => {
                          setActionsMenuOpen(false);
                          setPublishSubOpen(false);
                          setFlowStatus("published");
                          setFlowVisibility("global");
                          void updateFlowMutation
                            .mutateAsync({ flowId, status: "published", visibility: { kind: "global" } })
                            .then(() => toast.success("Flow published globally"));
                        }}
                      >
                        Publish globally (everyone)
                      </button>
                      <button
                        type="button"
                        className="w-full px-3 py-2 text-left text-[13px] text-[#1a1814] hover:bg-[#efede8]"
                        onClick={() => {
                          setActionsMenuOpen(false);
                          setPublishSubOpen(false);
                          setFlowStatus("published");
                          setFlowVisibility("private");
                          void updateFlowMutation
                            .mutateAsync({ flowId, status: "published", visibility: { kind: "private" } })
                            .then(() => toast.success("Flow published privately"));
                        }}
                      >
                        Publish privately (only you)
                      </button>
                    </>
                  )}
                  {flowStatus === "published" && flowVisibility === "private" && (
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left text-[13px] text-[#1a1814] hover:bg-[#efede8]"
                      onClick={() => {
                        setActionsMenuOpen(false);
                        setPublishSubOpen(false);
                        setFlowVisibility("global");
                        void updateFlowMutation
                          .mutateAsync({ flowId, visibility: { kind: "global" } })
                          .then(() => toast.success("Flow is now visible to everyone"));
                      }}
                    >
                      Make global (everyone)
                    </button>
                  )}
                  {flowStatus === "published" && flowVisibility === "global" && (
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left text-[13px] text-[#1a1814] hover:bg-[#efede8]"
                      onClick={() => {
                        setActionsMenuOpen(false);
                        setPublishSubOpen(false);
                        setFlowVisibility("private");
                        void updateFlowMutation
                          .mutateAsync({ flowId, visibility: { kind: "private" } })
                          .then(() => toast.success("Flow is now private"));
                      }}
                    >
                      Make private (only you)
                    </button>
                  )}
                  {flowStatus === "published" && hasUnpublishedChanges && (
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left text-[13px] text-[#1a1814] hover:bg-[#efede8]"
                      onClick={() => {
                        setActionsMenuOpen(false);
                        setPublishSubOpen(false);
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
                  {flowStatus === "published" && (
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left text-[13px] text-[#1a1814] hover:bg-[#efede8]"
                      onClick={() => {
                        setActionsMenuOpen(false);
                        setPublishSubOpen(false);
                        setFlowStatus("draft");
                        void updateFlowMutation
                          .mutateAsync({ flowId, status: "draft" })
                          .then(() => toast.success("Flow unpublished"));
                      }}
                    >
                      Unpublish
                    </button>
                  )}
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="w-full px-3 py-2 text-left text-[13px] text-[#1a1814] hover:bg-[#efede8]"
                    onClick={() => setPublishSubOpen(true)}
                  >
                    Update published state
                  </button>
                  <Link
                    href="/chats"
                    className="block w-full px-3 py-2 text-left text-[13px] text-[#1a1814] hover:bg-[#efede8]"
                    onClick={() => setActionsMenuOpen(false)}
                  >
                    Open Chat
                  </Link>
                </>
              )}
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-[13px] text-[#1a1814] hover:bg-[#efede8]"
                onClick={() => {
                  setActionsMenuOpen(false);
                  setVersionHistoryOpen(true);
                }}
              >
                Version history
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
