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
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ConversationalNodeData } from "@/components/canvas/conversational-node";
import { ConversationalNode } from "@/components/canvas/conversational-node";
import { ContextDocsStrip } from "@/components/canvas/context-docs-strip";
import type { NodeConfigValues } from "@/components/canvas/node-config-modal";
import { NodeConfigModal } from "@/components/canvas/node-config-modal";
import { trpc } from "@/trpc/client";
import type { FlowContextDoc } from "@rbrasier/domain";

const NODE_TYPES = { conversationalNode: ConversationalNode };
const DEBOUNCE_MS = 600;

const toRfNode = (node: {
  id: string;
  name: string;
  colour: string | null;
  positionX: number;
  positionY: number;
  config: Record<string, unknown>;
}): Node<ConversationalNodeData> => ({
  id: node.id,
  type: "conversationalNode",
  position: { x: node.positionX, y: node.positionY },
  data: {
    name: node.name,
    colour: node.colour,
    aiInstruction: (node.config.aiInstruction as string | null) ?? null,
    doneWhen: (node.config.doneWhen as string | null) ?? null,
    outputType: (node.config.outputType as "conversation_only" | "generate_document" | null) ?? "conversation_only",
    documentTemplatePath: (node.config.documentTemplatePath as string | null) ?? null,
    documentTemplateFilename: (node.config.documentTemplateFilename as string | null) ?? null,
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
  const { fitView } = useReactFlow();
  const canvasQuery = trpc.flow.getCanvas.useQuery({ flowId });

  const [rfNodes, setRfNodes] = useState<Node[]>([]);
  const [rfEdges, setRfEdges] = useState<Edge[]>([]);
  const [contextDocs, setContextDocs] = useState<FlowContextDoc[]>([]);
  const [flowName, setFlowName] = useState("");
  const [flowStatus, setFlowStatus] = useState<"draft" | "published">("draft");
  const [expertRole, setExpertRole] = useState<string>("");
  const [expertRoleFocused, setExpertRoleFocused] = useState(false);
  const expertRoleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [configOpen, setConfigOpen] = useState(false);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [pendingEdge, setPendingEdge] = useState<{ fromNodeId: string; toNodeId: string } | null>(null);
  const [isSavingConfig, setIsSavingConfig] = useState(false);

  const positionTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const updateFlowMutation = trpc.flow.update.useMutation();
  const createNodeMutation = trpc.flow.node.create.useMutation();
  const updateNodeMutation = trpc.flow.node.update.useMutation();
  const updatePositionMutation = trpc.flow.node.updatePosition.useMutation();
  const deleteNodeMutation = trpc.flow.node.delete.useMutation();
  const createEdgeMutation = trpc.flow.edge.create.useMutation();
  const deleteEdgeMutation = trpc.flow.edge.delete.useMutation();

  useEffect(() => {
    const data = canvasQuery.data;
    if (!data) return;
    setRfNodes(data.nodes.map(toRfNode));
    setRfEdges(data.edges.map(toRfEdge));
    setContextDocs(data.flow.contextDocs);
    setFlowName(data.flow.name);
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
      data: { name: "New step", colour: "#6366f1", aiInstruction: null },
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

  const handleUploadTemplate = useCallback(async (file: File): Promise<{ path: string; filename: string } | { error: string }> => {
    if (!editingNodeId || editingNodeId.startsWith("temp-")) {
      return { error: "Save the step first before uploading a template." };
    }
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`/api/flows/${flowId}/nodes/${editingNodeId}/template`, {
      method: "POST",
      body: formData,
    });
    const data = await res.json() as { path?: string; filename?: string; error?: string };
    if (!res.ok || data.error) {
      return { error: data.error ?? "Upload failed" };
    }
    return { path: data.path!, filename: data.filename! };
  }, [editingNodeId, flowId]);

  const handleConfigSave = useCallback(async (values: NodeConfigValues) => {
    if (!editingNodeId) return;
    setIsSavingConfig(true);
    const config = {
      aiInstruction: values.aiInstruction,
      doneWhen: values.doneWhen,
      outputType: values.outputType,
      documentTemplatePath: values.documentTemplatePath ?? null,
      documentTemplateFilename: values.documentTemplateFilename ?? null,
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
          nds.map((n) => (n.id === editingNodeId ? { ...toRfNode({ ...newNode, config }), id: newNode.id } : n)),
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
              ? { ...n, data: { ...n.data, name: values.name, colour: values.colour, aiInstruction: values.aiInstruction } }
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
        outputType: (editingData.outputType as "conversation_only" | "generate_document" | null) ?? "conversation_only",
        documentTemplatePath: (editingData.documentTemplatePath as string | null) ?? null,
        documentTemplateFilename: (editingData.documentTemplateFilename as string | null) ?? null,
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
        <div className="h-4 w-px bg-border" />
        <span className="text-xs text-[#918d87]">Expert role</span>
        <input
          type="text"
          value={expertRole}
          placeholder="e.g. procurement specialist"
          className={`h-7 rounded-md border px-2 text-xs text-[#1a1814] outline-none transition-colors ${expertRoleFocused ? "border-[#3a5fd9]" : "border-[#dedad2]"} bg-[#f7f6f3]`}
          style={{ width: "180px" }}
          onFocus={() => setExpertRoleFocused(true)}
          onBlur={() => setExpertRoleFocused(false)}
          onChange={(e) => {
            const value = e.target.value;
            setExpertRole(value);
            if (expertRoleTimer.current) clearTimeout(expertRoleTimer.current);
            expertRoleTimer.current = setTimeout(() => {
              void updateFlowMutation.mutateAsync({ flowId, expertRole: value || null });
            }, 800);
          }}
        />
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const target = flowStatus === "published" ? "draft" : "published";
              setFlowStatus(target);
              void updateFlowMutation.mutateAsync({ flowId, status: target }).then(() => {
                toast.success(target === "published" ? "Flow published" : "Flow unpublished");
              });
            }}
          >
            {flowStatus === "published" ? "Unpublish" : "Publish"}
          </Button>
          <Button size="sm" disabled title="Available in Phase 2">Open Chat</Button>
        </div>
      </div>

      <div className="flex-1 relative">
        <ReactFlow
          nodes={rfNodes}
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
    </div>
  );
}

export default function FlowOwnerCanvasPage() {
  const params = useParams<{ id: string }>();
  return (
    <ReactFlowProvider>
      <CanvasInner flowId={params.id} />
    </ReactFlowProvider>
  );
}
