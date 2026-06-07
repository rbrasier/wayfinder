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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ConversationalNodeData } from "@/components/canvas/conversational-node";
import { ConversationalNode } from "@/components/canvas/conversational-node";
import type { AutoNodeData } from "@/components/canvas/auto-node";
import { AutoNode } from "@/components/canvas/auto-node";
import type { ScheduledNodeData } from "@/components/canvas/scheduled-node";
import { ScheduledNode } from "@/components/canvas/scheduled-node";
import { ContextDocsStrip } from "@/components/canvas/context-docs-strip";
import type { NodeConfigValues } from "@/components/canvas/node-config-modal";
import { NodeConfigModal } from "@/components/canvas/node-config-modal";
import {
  scheduledConfigFromValues,
  scheduledValuesFromConfig,
} from "@/components/canvas/scheduled-node-config";
import { trpc } from "@/trpc/client";
import type { FieldValueSource, FlowContextDoc, PriorStepField, TemplateField } from "@rbrasier/domain";
import { computeStepNumbers } from "@/lib/flow-utils";

const NODE_TYPES = {
  conversationalNode: ConversationalNode,
  autoNode: AutoNode,
  scheduledNode: ScheduledNode,
};

const DEBOUNCE_MS = 600;

interface RawNode {
  id: string;
  name: string;
  colour: string | null;
  type?: "conversational" | "auto" | "scheduled";
  positionX: number;
  positionY: number;
  config: Record<string, unknown>;
}

const readFields = (value: unknown): TemplateField[] =>
  Array.isArray(value) ? (value as TemplateField[]) : [];

const toRfNode = (node: RawNode, stepNumber: number | null): Node => {
  if (node.type === "auto") {
    const data: AutoNodeData = {
      name: node.name,
      colour: node.colour,
      instruction: (node.config.instruction as string | null) ?? null,
      requestFieldCount: readFields(node.config.requestFields).length,
      responseFieldCount: readFields(node.config.responseFields).length,
      stepNumber,
      config: node.config,
    };
    return { id: node.id, type: "autoNode", position: { x: node.positionX, y: node.positionY }, data };
  }

  if (node.type === "scheduled") {
    const data: ScheduledNodeData = {
      name: node.name,
      colour: node.colour,
      kind: (node.config.kind as string | null) ?? null,
      spec: (node.config.spec as string | null) ?? null,
      recurring: Boolean(node.config.recurring),
      stepNumber,
      config: node.config,
    };
    return { id: node.id, type: "scheduledNode", position: { x: node.positionX, y: node.positionY }, data };
  }

  const data: ConversationalNodeData = {
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
    config: node.config,
  };
  return { id: node.id, type: "conversationalNode", position: { x: node.positionX, y: node.positionY }, data };
};

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
  const [flowVisibility, setFlowVisibility] = useState<"private" | "global">("private");
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [publishSubOpen, setPublishSubOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const actionsMenuRef = useRef<HTMLDivElement>(null);
  const autoNodeEnabled = trpc.featureFlag.isEnabledForMe.useQuery({ key: "auto_node" }).data ?? false;
  const scheduledNodeEnabled =
    trpc.featureFlag.isEnabledForMe.useQuery({ key: "scheduled_node" }).data ?? false;

  const [configOpen, setConfigOpen] = useState(false);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [pendingEdge, setPendingEdge] = useState<{ fromNodeId: string; toNodeId: string } | null>(null);
  const [isSavingConfig, setIsSavingConfig] = useState(false);

  const positionTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const updateFlowMutation = trpc.flow.update.useMutation({
    onSuccess: () => utils.flow.getCanvas.invalidate({ flowId }),
  });

  useEffect(() => {
    if (!actionsMenuOpen) return;
    const handler = (event: MouseEvent) => {
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(event.target as HTMLElement)) {
        setActionsMenuOpen(false);
        setPublishSubOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [actionsMenuOpen]);
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
    setFlowStatus(data.flow.status);
    setFlowVisibility(data.flow.visibility.kind);
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

    const buildConfig = (): Record<string, unknown> => {
      if (values.type === "auto") {
        return {
          instruction: values.instruction,
          executor: values.executor,
          workflowId: values.workflowId,
          webhookUrl: values.webhookUrl,
          requestFields: values.requestFields,
          requestFieldValues: values.requestFieldValues,
          responseFields: values.responseFields,
        };
      }
      if (values.type === "scheduled") {
        return scheduledConfigFromValues(values);
      }
      return {
        aiInstruction: values.aiInstruction,
        doneWhen: values.neverDone ? "" : values.doneWhen,
        neverDone: values.neverDone,
        outputType: values.outputType,
        documentTemplatePath: values.documentTemplatePath ?? null,
        documentTemplateFilename: values.documentTemplateFilename ?? null,
        documentTemplateContent: values.documentTemplateContent ?? null,
      };
    };
    const config: Record<string, unknown> = buildConfig();

    const isTempNode = editingNodeId.startsWith("temp-");
    const position = rfNodes.find((n) => n.id === editingNodeId)?.position ?? { x: 200, y: 200 };

    try {
      if (isTempNode) {
        const newNode = await createNodeMutation.mutateAsync({
          flowId,
          name: values.name,
          colour: values.colour,
          type: values.type,
          positionX: position.x,
          positionY: position.y,
          config,
        });

        const rebuilt = toRfNode({ id: newNode.id, name: values.name, colour: values.colour, type: values.type, positionX: position.x, positionY: position.y, config }, null);
        setRfNodes((nds) => nds.map((n) => (n.id === editingNodeId ? rebuilt : n)));

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
          type: values.type,
          config,
        });
        setRfNodes((nds) =>
          nds.map((n) => {
            if (n.id !== editingNodeId) return n;
            return toRfNode({ id: n.id, name: values.name, colour: values.colour, type: values.type, positionX: n.position.x, positionY: n.position.y, config }, null);
          }),
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
      data: { name: "New step", colour: "#6366f1", aiInstruction: null },
    };
    setRfNodes((nds) => [...nds, tempNode]);
    setEditingNodeId(tempId);
    setConfigOpen(true);
  }, [rfNodes]);

  const handleAddAutoNode = useCallback(() => {
    const tempId = `temp-${Date.now()}`;
    const xOffset = rfNodes.length > 0 ? (rfNodes[rfNodes.length - 1]?.position.x ?? 0) + 280 : 200;
    const tempNode: Node<AutoNodeData> = {
      id: tempId,
      type: "autoNode",
      position: { x: xOffset, y: 200 },
      data: { name: "New step", colour: "#7c3aed", instruction: null },
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

  const handleUploadTemplate = useCallback(async (
    file: File,
    currentValues: NodeConfigValues,
  ): Promise<{ path: string; filename: string; documentTemplateContent: string | null } | { error: string; code?: string }> => {
    let nodeId = editingNodeId;

    if (!nodeId || nodeId.startsWith("temp-")) {
      const tempId = nodeId;
      const newNode = await createNodeMutation.mutateAsync({
        flowId,
        name: currentValues.name || "New step",
        colour: currentValues.colour || "#6366f1",
        positionX: rfNodes.find((n) => n.id === tempId)?.position.x ?? 200,
        positionY: rfNodes.find((n) => n.id === tempId)?.position.y ?? 200,
        config: {
          aiInstruction: currentValues.aiInstruction,
          doneWhen: currentValues.neverDone ? "" : currentValues.doneWhen,
          neverDone: currentValues.neverDone,
          outputType: currentValues.outputType,
          documentTemplatePath: null,
          documentTemplateFilename: null,
          documentTemplateContent: null,
        },
      });

      setRfNodes((nds) =>
        nds.map((n) => (n.id === tempId ? { ...toRfNode({ ...newNode, config: newNode.config as Record<string, unknown> }, null), id: newNode.id } : n)),
      );
      setEditingNodeId(newNode.id);
      nodeId = newNode.id;

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
    }

    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`/api/flows/${flowId}/nodes/${nodeId}/template`, {
      method: "POST",
      body: formData,
    });
    const data = await res.json() as { path?: string; filename?: string; documentTemplateContent?: string | null; error?: string; code?: string };
    if (!res.ok || data.error) {
      return { error: data.error ?? "Upload failed", code: data.code };
    }
    return { path: data.path!, filename: data.filename!, documentTemplateContent: data.documentTemplateContent ?? null };
  }, [editingNodeId, flowId, rfNodes, pendingEdge, createNodeMutation, createEdgeMutation]);

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

  const stepNumbers = useMemo(() => {
    const adaptedEdges = rfEdges.map((e) => ({ fromNodeId: e.source, toNodeId: e.target }));
    return computeStepNumbers(rfNodes, adaptedEdges);
  }, [rfNodes, rfEdges]);

  const rfNodesWithNumbers = useMemo(
    () => rfNodes.map((n) => ({ ...n, data: { ...n.data, stepNumber: stepNumbers.get(n.id) ?? null } })),
    [rfNodes, stepNumbers],
  );

  const priorStepFields = useMemo<PriorStepField[]>(() => {
    if (!editingNodeId) return [];
    const currentStep = stepNumbers.get(editingNodeId);
    if (currentStep == null) return [];
    const result: PriorStepField[] = [];
    for (const node of rfNodes) {
      const step = stepNumbers.get(node.id);
      if (step == null || step >= currentStep) continue;
      const config = ((node.data as { config?: Record<string, unknown> }).config ?? {}) as Record<
        string,
        unknown
      >;
      const fields =
        node.type === "autoNode"
          ? readFields(config.responseFields)
          : node.type === "scheduledNode"
            ? []
            : config.outputType === "generate_document"
              ? readFields(config.documentTemplateFields)
              : [];
      if (fields.length === 0) continue;
      const stepLabel = `${step}. ${(node.data as { name?: string }).name ?? "Step"}`;
      for (const field of fields) {
        result.push({
          nodeId: node.id,
          stepLabel,
          field: { key: field.key, label: field.label, type: field.type },
        });
      }
    }
    return result;
  }, [editingNodeId, rfNodes, stepNumbers]);

  const editingNode = editingNodeId ? rfNodes.find((n) => n.id === editingNodeId) : null;
  const editingData = editingNode?.data as (ConversationalNodeData & { config?: Record<string, unknown> }) | undefined;
  const editingConfig = (editingData?.config ?? {}) as Record<string, unknown>;

  const initialConfigValues: Partial<NodeConfigValues> | undefined = editingData
    ? {
        name: editingData.name,
        colour: editingData.colour ?? "#6366f1",
        type:
          editingNode?.type === "autoNode"
            ? "auto"
            : editingNode?.type === "scheduledNode"
              ? "scheduled"
              : "conversational",
        aiInstruction: (editingConfig.aiInstruction as string | null) ?? editingData.aiInstruction ?? "",
        doneWhen: (editingConfig.doneWhen as string | null) ?? "",
        neverDone: Boolean(editingConfig.neverDone),
        outputType: (editingConfig.outputType as "conversation_only" | "generate_document" | null) ?? "conversation_only",
        documentTemplatePath: (editingConfig.documentTemplatePath as string | null) ?? null,
        documentTemplateFilename: (editingConfig.documentTemplateFilename as string | null) ?? null,
        documentTemplateContent: (editingConfig.documentTemplateContent as string | null) ?? null,
        instruction: (editingConfig.instruction as string | null) ?? "",
        executor: (editingConfig.executor as "n8n" | "mock" | undefined) ?? "n8n",
        workflowId: (editingConfig.workflowId as string | null) ?? null,
        webhookUrl: (editingConfig.webhookUrl as string | null) ?? "",
        requestFields: readFields(editingConfig.requestFields),
        requestFieldValues:
          (editingConfig.requestFieldValues as Record<string, FieldValueSource> | undefined) ?? {},
        responseFields: readFields(editingConfig.responseFields),
        ...scheduledValuesFromConfig(editingConfig),
      }
    : undefined;

  if (canvasQuery.isLoading) {
    return <div className="flex h-96 items-center justify-center text-muted-foreground">Loading canvas…</div>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b bg-white px-4 py-3">
        <Link href="/admin/flows" className="shrink-0 text-[13px] text-[#5a5650] hover:text-[#1a1814]">
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
            className="text-[13px] font-semibold text-[#1a1814] hover:text-primary"
            onClick={() => setEditingName(true)}
          >
            {flowName || "Untitled flow"}
          </button>
        )}

        <Badge variant={flowStatus === "published" ? "default" : "secondary"}>
          {flowStatus === "published"
            ? `Published · ${flowVisibility === "global" ? "Everyone" : "Only you"}`
            : "Draft"}
        </Badge>

        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleAddStep}>
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
                    {autoNodeEnabled && (
                      <button
                        type="button"
                        className="w-full px-3 py-2 text-left text-[13px] text-[#1a1814] hover:bg-[#efede8]"
                        onClick={() => {
                          setActionsMenuOpen(false);
                          handleAddAutoNode();
                        }}
                      >
                        Add Auto Node
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="relative flex-1">
        <ReactFlow
          nodes={rfNodesWithNumbers}
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
        autoNodeEnabled={autoNodeEnabled}
        scheduledNodeEnabled={scheduledNodeEnabled}
        priorStepFields={priorStepFields}
        onUploadTemplate={handleUploadTemplate}
      />
    </div>
  );
}

export function AdminFlowContent({ flowId }: { flowId: string }) {
  return (
    <ReactFlowProvider>
      <CanvasInner flowId={flowId} />
    </ReactFlowProvider>
  );
}
