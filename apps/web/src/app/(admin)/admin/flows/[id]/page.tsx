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
  const utils = trpc.useUtils();
  const canvasQuery = trpc.flow.getCanvas.useQuery({ flowId });

  const [rfNodes, setRfNodes] = useState<Node[]>([]);
  const [rfEdges, setRfEdges] = useState<Edge[]>([]);
  const [contextDocs, setContextDocs] = useState<FlowContextDoc[]>([]);
  const [flowName, setFlowName] = useState("");
  const [flowStatus, setFlowStatus] = useState<"draft" | "published">("draft");
  const [editingName, setEditingName] = useState(false);

  const [configOpen, setConfigOpen] = useState(false);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [pendingEdge, setPendingEdge] = useState<{ fromNodeId: string; toNodeId: string } | null>(null);
  const [isSavingConfig, setIsSavingConfig] = useState(false);

  const positionTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const updateFlowMutation = trpc.flow.update.useMutation({
    onSuccess: () => utils.flow.getCanvas.invalidate({ flowId }),
  });
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
      setRfEdges((eds) =>
        eds.map((e) => (e.id === edge.id ? { ...e, id: created.id } : e)),
      );
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
      void updatePositionMutation.mutateAsync({
        nodeId: node.id,
        flowId,
        x: node.position.x,
        y: node.position.y,
      });
      positionTimers.current.delete(node.id);
    }, DEBOUNCE_MS);
    positionTimers.current.set(node.id, timer);
  }, [updatePositionMutation, flowId]);

  const handleConfigSave = useCallback(async (values: NodeConfigValues) => {
    if (!editingNodeId) return;
    setIsSavingConfig(true);

    const config = {
      aiInstruction: values.aiInstruction,
      doneWhen: values.doneWhen,
      outputType: values.outputType,
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
          nds.map((n) =>
            n.id === editingNodeId
              ? { ...toRfNode({ ...newNode, config }), id: newNode.id }
              : n,
          ),
        );

        if (pendingEdge) {
          const edge = await createEdgeMutation.mutateAsync({
            flowId,
            fromNodeId: pendingEdge.fromNodeId,
            toNodeId: newNode.id,
          });
          setRfEdges((eds) => [
            ...eds,
            { id: edge.id, source: edge.fromNodeId, target: edge.toNodeId, type: "smoothstep", markerEnd: { type: MarkerType.ArrowClosed } },
          ]);
          setPendingEdge(null);
        }
      } else {
        await updateNodeMutation.mutateAsync({
          nodeId: editingNodeId,
          flowId,
          name: values.name,
          colour: values.colour,
          config,
        });
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
    setRfEdges((eds) =>
      eds.filter((e) => e.source !== editingNodeId && e.target !== editingNodeId),
    );
    setConfigOpen(false);
    setEditingNodeId(null);
    toast.success("Step deleted");
  }, [editingNodeId, deleteNodeMutation, flowId]);

  const editingNode = editingNodeId ? rfNodes.find((n) => n.id === editingNodeId) : null;
  const editingData = editingNode?.data as ConversationalNodeData | undefined;

  const initialConfigValues = editingData
    ? {
        name: editingData.name,
        colour: editingData.colour ?? "#6366f1",
        aiInstruction: editingData.aiInstruction ?? "",
        doneWhen: (editingNode && (editingNode.data as Record<string, unknown>).doneWhen as string | undefined) ?? "",
        outputType: ((editingNode?.data as Record<string, unknown>).outputType as "conversation_only" | "generate_document" | undefined) ?? "conversation_only",
      }
    : undefined;

  if (canvasQuery.isLoading) {
    return <div className="flex h-96 items-center justify-center text-muted-foreground">Loading canvas…</div>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b bg-white px-4 py-3">
        <Link href="/admin/flows" className="text-sm text-muted-foreground hover:text-foreground">
          ← Flows
        </Link>
        <div className="h-4 w-px bg-border" />

        {editingName ? (
          <input
            autoFocus
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
                setFlowName(canvasQuery.data?.flow.name ?? "");
                setEditingName(false);
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="text-sm font-semibold hover:text-primary"
            onClick={() => setEditingName(true)}
          >
            {flowName || "Untitled flow"}
          </button>
        )}

        <Badge variant={flowStatus === "published" ? "default" : "secondary"}>
          {flowStatus === "published" ? "Published" : "Draft"}
        </Badge>

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
          <Button size="sm" asChild>
            <Link href="/chats">Open Chat</Link>
          </Button>
        </div>
      </div>

      <div className="relative flex-1">
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

      <ContextDocsStrip
        flowId={flowId}
        docs={contextDocs}
        onDocsChange={setContextDocs}
      />

      <NodeConfigModal
        open={configOpen}
        flowId={flowId}
        initialValues={initialConfigValues}
        onSave={handleConfigSave}
        onDelete={editingNodeId && !editingNodeId.startsWith("temp-") ? handleNodeDelete : undefined}
        onClose={handleConfigClose}
        isSaving={isSavingConfig}
      />
    </div>
  );
}

export default function FlowCanvasPage() {
  const params = useParams<{ id: string }>();
  return (
    <ReactFlowProvider>
      <CanvasInner flowId={params.id} />
    </ReactFlowProvider>
  );
}
