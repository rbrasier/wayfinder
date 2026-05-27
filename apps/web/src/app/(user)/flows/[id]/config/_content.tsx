"use client";

import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type OnConnectEnd,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ConversationalNodeData } from "@/components/canvas/conversational-node";
import { ConversationalNode } from "@/components/canvas/conversational-node";
import { ContextDocsStrip } from "@/components/canvas/context-docs-strip";
import type { NodeConfigValues } from "@/components/canvas/node-config-modal";
import { NodeConfigModal } from "@/components/canvas/node-config-modal";
import { FlowMetadataDialog, type FlowMetadataValues } from "@/components/flow/flow-metadata-dialog";
import { trpc } from "@/trpc/client";
import type { FlowContextDoc } from "@rbrasier/domain";
import { orderStepIds } from "@/lib/step-order";

const NODE_TYPES = { conversationalNode: ConversationalNode };
const DEBOUNCE_MS = 600;

const toRfNode = (
  node: {
    id: string;
    name: string;
    colour: string | null;
    positionX: number;
    positionY: number;
    config: Record<string, unknown>;
  },
  stepNumber: number | null,
): Node<ConversationalNodeData> => ({
  id: node.id,
  type: "conversationalNode",
  position: { x: node.positionX, y: node.positionY },
  data: {
    name: node.name,
    colour: node.colour,
    aiInstruction: (node.config.aiInstruction as string | null) ?? null,
    stepNumber,
    doneWhen: (node.config.doneWhen as string | null) ?? null,
    neverDone: Boolean(node.config.neverDone),
    outputType: (node.config.outputType as "conversation_only" | "generate_document" | null) ?? "conversation_only",
    documentTemplatePath: (node.config.documentTemplatePath as string | null) ?? null,
    documentTemplateFilename: (node.config.documentTemplateFilename as string | null) ?? null,
    documentTemplateContent: (node.config.documentTemplateContent as string | null) ?? null,
  },
});

const toRfEdge = (edge: { id: string; fromNodeId: string; toNodeId: string }): Edge => ({
  id: edge.id,
  source: edge.fromNodeId,
  target: edge.toNodeId,
  type: "smoothstep",
  markerEnd: { type: MarkerType.ArrowClosed },
});

function CanvasInner({ flowId }: { flowId: string }) {
  const router = useRouter();
  const { fitView } = useReactFlow();
  const canvasQuery = trpc.flow.getCanvas.useQuery({ flowId });

  const [rfNodes, setRfNodes] = useState<Node[]>([]);
  const [rfEdges, setRfEdges] = useState<Edge[]>([]);
  const [contextDocs, setContextDocs] = useState<FlowContextDoc[]>([]);
  const [flowName, setFlowName] = useState("");
  const [flowDescription, setFlowDescription] = useState<string>("");
  const [flowIcon, setFlowIcon] = useState<string>("");
  const [flowStatus, setFlowStatus] = useState<"draft" | "published">("draft");
  const [expertRole, setExpertRole] = useState<string>("");
  const [editingMetadata, setEditingMetadata] = useState(false);

  const [configOpen, setConfigOpen] = useState(false);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [pendingEdge, setPendingEdge] = useState<{ fromNodeId: string; toNodeId: string } | null>(null);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [flowMenuOpen, setFlowMenuOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const flowMenuRef = useRef<HTMLDivElement>(null);

  const positionTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    if (!flowMenuOpen) return;
    const handler = (event: MouseEvent) => {
      if (flowMenuRef.current && !flowMenuRef.current.contains(event.target as HTMLElement)) {
        setFlowMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [flowMenuOpen]);

  const updateFlowMutation = trpc.flow.update.useMutation();
  const deleteFlowMutation = trpc.flow.delete.useMutation();
  const createNodeMutation = trpc.flow.node.create.useMutation();
  const updateNodeMutation = trpc.flow.node.update.useMutation();
  const updatePositionMutation = trpc.flow.node.updatePosition.useMutation();
  const deleteNodeMutation = trpc.flow.node.delete.useMutation();
  const createEdgeMutation = trpc.flow.edge.create.useMutation();
  const deleteEdgeMutation = trpc.flow.edge.delete.useMutation();

  useEffect(() => {
    const data = canvasQuery.data;
    if (!data) return;
    setRfNodes(data.nodes.map((n) => toRfNode(n, null)));
    setRfEdges(data.edges.map(toRfEdge));
    setContextDocs(data.flow.contextDocs);
    setFlowName(data.flow.name);
    setFlowDescription(data.flow.description ?? "");
    setFlowIcon(data.flow.icon ?? "");
    setFlowStatus(data.flow.status);
    setExpertRole(data.flow.expertRole ?? "");
    if (data.nodes.length > 3) {
      setTimeout(() => { fitView({ padding: 0.2 }); }, 100);
    }
  }, [canvasQuery.data, fitView]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setRfNodes((nds) => applyNodeChanges(changes, nds));
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setRfEdges((eds) => applyEdgeChanges(changes, eds));
    const deletions = changes.filter((c) => c.type === "remove");
    for (const del of deletions) {
      void deleteEdgeMutation.mutateAsync({ edgeId: del.id, flowId });
    }
  }, [deleteEdgeMutation, flowId]);

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    const edge: Edge = {
      ...connection,
      id: `pending-${Date.now()}`,
      type: "smoothstep",
      markerEnd: { type: MarkerType.ArrowClosed },
      source: connection.source,
      target: connection.target,
    };
    setRfEdges((eds) => addEdge(edge, eds));
    void createEdgeMutation.mutateAsync({
      flowId,
      fromNodeId: connection.source,
      toNodeId: connection.target,
    }).then((created) => {
      setRfEdges((eds) => eds.map((e) => (e.id === edge.id ? { ...e, id: created.id } : e)));
    });
  }, [createEdgeMutation, flowId]);

  const onConnectEnd: OnConnectEnd = useCallback((event, connectionState) => {
    if (connectionState.isValid) return;
    if (!connectionState.fromNode) return;

    const fromNodeId = connectionState.fromNode.id;
    const target = event instanceof MouseEvent ? event : (event as TouchEvent).touches[0];
    if (!target) return;

    const paneEl = document.querySelector(".react-flow__pane");
    if (!paneEl) return;
    const paneRect = paneEl.getBoundingClientRect();

    const tempId = `temp-${Date.now()}`;
    const tempNode: Node<ConversationalNodeData> = {
      id: tempId,
      type: "conversationalNode",
      position: { x: target.clientX - paneRect.left - 112, y: target.clientY - paneRect.top - 40 },
      data: { name: "New step", colour: "#3a5fd9", aiInstruction: null },
    };

    setRfNodes((nds) => [...nds, tempNode]);
    setPendingEdge({ fromNodeId, toNodeId: tempId });
    setEditingNodeId(tempId);
    setConfigOpen(true);
  }, []);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setEditingNodeId(node.id);
    setConfigOpen(true);
  }, []);

  const onNodeDragStop = useCallback((_: React.MouseEvent, node: Node) => {
    const existing = positionTimers.current.get(node.id);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      void updatePositionMutation.mutateAsync({ nodeId: node.id, flowId, x: node.position.x, y: node.position.y });
      positionTimers.current.delete(node.id);
    }, DEBOUNCE_MS);
    positionTimers.current.set(node.id, timer);
  }, [updatePositionMutation, flowId]);

  const handleUploadTemplate = useCallback(async (file: File): Promise<{ path: string; filename: string; documentTemplateContent: string | null } | { error: string; code?: string }> => {
    if (!editingNodeId || editingNodeId.startsWith("temp-")) {
      return { error: "Save the step first before uploading a template." };
    }
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`/api/flows/${flowId}/nodes/${editingNodeId}/template`, {
      method: "POST",
      body: formData,
    });
    const data = await res.json() as { path?: string; filename?: string; documentTemplateContent?: string | null; error?: string; code?: string };
    if (!res.ok || data.error) {
      return { error: data.error ?? "Upload failed", code: data.code };
    }
    return { path: data.path!, filename: data.filename!, documentTemplateContent: data.documentTemplateContent ?? null };
  }, [editingNodeId, flowId]);

  const handleConfigSave = useCallback(async (values: NodeConfigValues) => {
    if (!editingNodeId) return;
    setIsSavingConfig(true);
    const config = {
      aiInstruction: values.aiInstruction,
      doneWhen: values.neverDone ? "" : values.doneWhen,
      neverDone: values.neverDone,
      outputType: values.outputType,
      documentTemplatePath: values.documentTemplatePath ?? null,
      documentTemplateFilename: values.documentTemplateFilename ?? null,
      documentTemplateContent: values.documentTemplateContent ?? null,
    };
    const isTempNode = editingNodeId.startsWith("temp-");

    try {
      if (isTempNode) {
        const newNode = await createNodeMutation.mutateAsync({
          flowId,
          name: values.name,
          colour: values.colour,
          positionX: rfNodes.find((n) => n.id === editingNodeId)?.position.x ?? 200,
          positionY: rfNodes.find((n) => n.id === editingNodeId)?.position.y ?? 200,
          config,
        });
        setRfNodes((nds) =>
          nds.map((n) => (n.id === editingNodeId ? { ...toRfNode({ ...newNode, config }, null), id: newNode.id } : n)),
        );
        if (pendingEdge) {
          const edge = await createEdgeMutation.mutateAsync({ flowId, fromNodeId: pendingEdge.fromNodeId, toNodeId: newNode.id });
          setRfEdges((eds) => [
            ...eds,
            { id: edge.id, source: edge.fromNodeId, target: edge.toNodeId, type: "smoothstep", markerEnd: { type: MarkerType.ArrowClosed } },
          ]);
          setPendingEdge(null);
        }
      } else {
        await updateNodeMutation.mutateAsync({ nodeId: editingNodeId, flowId, name: values.name, colour: values.colour, config });
        setRfNodes((nds) =>
          nds.map((n) =>
            n.id === editingNodeId
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    name: values.name,
                    colour: values.colour,
                    aiInstruction: values.aiInstruction,
                    doneWhen: config.doneWhen,
                    neverDone: config.neverDone,
                    outputType: config.outputType,
                    documentTemplatePath: config.documentTemplatePath,
                    documentTemplateFilename: config.documentTemplateFilename,
                    documentTemplateContent: config.documentTemplateContent,
                  },
                }
              : n,
          ),
        );
      }
      setConfigOpen(false);
      setEditingNodeId(null);
    } finally {
      setIsSavingConfig(false);
    }
  }, [editingNodeId, flowId, rfNodes, pendingEdge, createNodeMutation, updateNodeMutation, createEdgeMutation]);

  const handleAddStep = useCallback(() => {
    const tempId = `temp-${Date.now()}`;
    const xOffset = rfNodes.length > 0 ? (rfNodes[rfNodes.length - 1]?.position.x ?? 0) + 280 : 200;
    const tempNode: Node<ConversationalNodeData> = {
      id: tempId,
      type: "conversationalNode",
      position: { x: xOffset, y: 200 },
      data: { name: "New step", colour: "#3a5fd9", aiInstruction: null, doneWhen: null, neverDone: false, outputType: "conversation_only", documentTemplatePath: null, documentTemplateFilename: null, documentTemplateContent: null },
    };
    setRfNodes((nds) => [...nds, tempNode]);
    setEditingNodeId(tempId);
    setConfigOpen(true);
  }, [rfNodes]);

  const handleConfigClose = useCallback(() => {
    if (editingNodeId?.startsWith("temp-")) {
      setRfNodes((nds) => nds.filter((n) => n.id !== editingNodeId));
      setPendingEdge(null);
    }
    setConfigOpen(false);
    setEditingNodeId(null);
  }, [editingNodeId]);

  const handleNodeDelete = useCallback(async () => {
    if (!editingNodeId || editingNodeId.startsWith("temp-")) return;
    await deleteNodeMutation.mutateAsync({ nodeId: editingNodeId, flowId });
    setRfNodes((nds) => nds.filter((n) => n.id !== editingNodeId));
    setRfEdges((eds) => eds.filter((e) => e.source !== editingNodeId && e.target !== editingNodeId));
    setConfigOpen(false);
    setEditingNodeId(null);
    toast.success("Step deleted");
  }, [editingNodeId, deleteNodeMutation, flowId]);

  const stepOrder = useMemo(() => {
    const orderable = rfNodes.map((n) => ({ id: n.id, positionX: n.position.x }));
    const edgeData = rfEdges.map((e) => ({ fromNodeId: e.source, toNodeId: e.target }));
    const ids = orderStepIds(orderable, edgeData);
    return new Map(ids.map((id, index) => [id, index + 1]));
  }, [rfNodes, rfEdges]);

  const displayNodes = useMemo(
    () =>
      rfNodes.map((n) => ({
        ...n,
        data: { ...(n.data as ConversationalNodeData), stepNumber: stepOrder.get(n.id) ?? null },
      })),
    [rfNodes, stepOrder],
  );

  if (canvasQuery.isLoading) {
    return <div className="flex items-center justify-center h-96 text-muted-foreground">Loading canvas…</div>;
  }

  if (canvasQuery.error?.data?.httpStatus === 403) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4 text-center">
        <p className="text-xl font-semibold text-gray-900">Access denied</p>
        <p className="text-sm text-muted-foreground">You do not have permission to edit this flow.</p>
        <Link href="/" className="text-sm text-indigo-600 hover:underline">Go home</Link>
      </div>
    );
  }

  const editingNode = editingNodeId ? rfNodes.find((n) => n.id === editingNodeId) : null;
  const editingData = editingNode?.data as ConversationalNodeData | undefined;
  const initialConfigValues = editingData
    ? {
        name: editingData.name,
        colour: editingData.colour ?? "#6366f1",
        aiInstruction: editingData.aiInstruction ?? "",
        doneWhen: (editingData.doneWhen as string | null) ?? "",
        neverDone: Boolean(editingData.neverDone),
        outputType: (editingData.outputType as "conversation_only" | "generate_document" | null) ?? "conversation_only",
        documentTemplatePath: (editingData.documentTemplatePath as string | null) ?? null,
        documentTemplateFilename: (editingData.documentTemplateFilename as string | null) ?? null,
        documentTemplateContent: (editingData.documentTemplateContent as string | null) ?? null,
      }
    : undefined;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b bg-white px-4 py-3 shrink-0">
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">← Home</Link>
        <div className="h-4 w-px bg-border" />
        <span className="text-sm font-semibold">{flowName}</span>
        <Badge variant={flowStatus === "published" ? "default" : "secondary"}>
          {flowStatus === "published" ? "Published" : "Draft"}
        </Badge>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleAddStep}>
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
              <div className="absolute right-0 top-full z-50 mt-1 w-44 rounded-[9px] border border-[#dedad2] bg-white py-1 shadow-md">
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left text-[13px] text-[#1a1814] hover:bg-[#efede8]"
                  onClick={() => {
                    setFlowMenuOpen(false);
                    const target = flowStatus === "published" ? "draft" : "published";
                    setFlowStatus(target);
                    void updateFlowMutation.mutateAsync({ flowId, status: target }).then(() => {
                      toast.success(target === "published" ? "Flow published" : "Flow unpublished");
                    });
                  }}
                >
                  {flowStatus === "published" ? "Unpublish" : "Publish"}
                </button>
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

      <div className="flex-1 relative">
        <ReactFlow
          nodes={displayNodes}
          edges={rfEdges}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectEnd={onConnectEnd}
          onNodeClick={onNodeClick}
          onNodeDragStop={onNodeDragStop}
          fitView
          deleteKeyCode="Backspace"
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
          <Controls />
          <MiniMap zoomable pannable />
        </ReactFlow>
      </div>

      <ContextDocsStrip flowId={flowId} docs={contextDocs} onDocsChange={setContextDocs} />

      <NodeConfigModal
        open={configOpen}
        flowId={flowId}
        initialValues={initialConfigValues}
        onSave={handleConfigSave}
        onDelete={editingNodeId && !editingNodeId.startsWith("temp-") ? handleNodeDelete : undefined}
        onClose={handleConfigClose}
        isSaving={isSavingConfig}
        onUploadTemplate={editingNodeId && !editingNodeId.startsWith("temp-") ? handleUploadTemplate : undefined}
      />

      <FlowMetadataDialog
        open={editingMetadata}
        mode="edit"
        initialValues={{
          name: flowName,
          expertRole,
          description: flowDescription,
          icon: flowIcon || "🗂️",
        }}
        isSaving={updateFlowMutation.isPending}
        onSubmit={(values: FlowMetadataValues) => {
          setFlowName(values.name);
          setExpertRole(values.expertRole);
          setFlowDescription(values.description);
          setFlowIcon(values.icon);
          void updateFlowMutation
            .mutateAsync({
              flowId,
              name: values.name,
              expertRole: values.expertRole,
              description: values.description || null,
              icon: values.icon || null,
            })
            .then(() => {
              setEditingMetadata(false);
              toast.success("Flow updated");
            });
        }}
        onClose={() => setEditingMetadata(false)}
      />

      <Dialog open={deleteConfirmOpen} onOpenChange={(open) => !open && setDeleteConfirmOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete flow?</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody>
            <p className="text-[13px] leading-[1.55] text-[#5a5650]">
              This flow will be deleted. Existing chats can still be viewed but no new messages
              can be sent. This action cannot be undone.
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={deleteFlowMutation.isPending}
              onClick={() => {
                void deleteFlowMutation.mutateAsync({ flowId }).then(() => {
                  toast.success("Flow deleted");
                  router.push("/");
                });
              }}
            >
              {deleteFlowMutation.isPending ? "Deleting…" : "Delete flow"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function FlowOwnerCanvasContent({ flowId }: { flowId: string }) {
  return (
    <ReactFlowProvider>
      <CanvasInner flowId={flowId} />
    </ReactFlowProvider>
  );
}
