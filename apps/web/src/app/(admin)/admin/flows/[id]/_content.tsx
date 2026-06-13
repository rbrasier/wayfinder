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
import type { ApprovalNodeData } from "@/components/canvas/approval-node";
import { ApprovalNode } from "@/components/canvas/approval-node";
import { ContextDocsStrip } from "@/components/canvas/context-docs-strip";
import type { NodeConfigType, NodeConfigValues } from "@/components/canvas/node-config-modal";
import { NodeConfigModal } from "@/components/canvas/node-config-modal";
import { NodeTypePickerModal } from "@/components/canvas/node-type-picker-modal";
import { VersionHistoryDialog } from "@/components/canvas/version-history-dialog";
import { STEP_TYPE_ACCENT } from "@/components/canvas/node-styles";
import { defaultConfigForType } from "@/components/canvas/node-defaults";
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
  approvalNode: ApprovalNode,
};

const DEBOUNCE_MS = 600;

interface RawNode {
  id: string;
  name: string;
  colour: string | null;
  type?: "conversational" | "auto" | "scheduled" | "approval";
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

  if (node.type === "approval") {
    const data: ApprovalNodeData = {
      name: node.name,
      colour: node.colour,
      approverSource: (node.config.approverSource as string | null) ?? null,
      stepNumber,
      config: node.config,
    };
    return { id: node.id, type: "approvalNode", position: { x: node.positionX, y: node.positionY }, data };
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
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const actionsMenuRef = useRef<HTMLDivElement>(null);
  const autoNodeEnabled = trpc.featureFlag.isEnabledForMe.useQuery({ key: "auto_node" }).data ?? false;
  const scheduledNodeEnabled =
    trpc.featureFlag.isEnabledForMe.useQuery({ key: "scheduled_node" }).data ?? false;

  const [configOpen, setConfigOpen] = useState(false);
  const [typePickerOpen, setTypePickerOpen] = useState(false);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  // The node just created by the picker / a drag-out. Deleted if the author
  // cancels the config modal, so picking a type and backing out leaves no
  // orphan — while still being a real, persisted node during editing.
  const [createdNodeId, setCreatedNodeId] = useState<string | null>(null);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  // A connector dragged into blank space: the new node's source and drop point.
  // The type picker resolves the type first, mirroring the Add step button.
  const [pendingConnect, setPendingConnect] = useState<{
    fromNodeId: string;
    position: { x: number; y: number };
  } | null>(null);

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

  // Persists a new node immediately (auto-save), optionally wiring an edge from
  // a source node, then opens its config modal. The node exists in the DB before
  // any field is entered, so uploads and other in-modal actions work right away.
  const createAndEditNode = useCallback(
    async (type: NodeConfigType, position: { x: number; y: number }, fromNodeId?: string) => {
      const config = defaultConfigForType(type);
      const colour = STEP_TYPE_ACCENT[type];
      const created = await createNodeMutation.mutateAsync({
        flowId,
        name: "",
        colour,
        type,
        positionX: position.x,
        positionY: position.y,
        config,
      });
      const rebuilt = toRfNode(
        { id: created.id, name: "", colour, type, positionX: position.x, positionY: position.y, config },
        null,
      );
      setRfNodes((nds) => [...nds, rebuilt]);
      if (fromNodeId) {
        const edge = await createEdgeMutation.mutateAsync({ flowId, fromNodeId, toNodeId: created.id });
        setRfEdges((eds) => [
          ...eds,
          { id: edge.id, source: edge.fromNodeId, target: edge.toNodeId, type: "smoothstep", markerEnd: { type: MarkerType.ArrowClosed } },
        ]);
      }
      setCreatedNodeId(created.id);
      setEditingNodeId(created.id);
      setConfigOpen(true);
    },
    [createNodeMutation, createEdgeMutation, flowId],
  );

  const onConnectEnd: OnConnectEnd = useCallback((event, connectionState) => {
    if (connectionState.isValid) return;
    if (!connectionState.fromNode) return;

    const fromNodeId = connectionState.fromNode.id;
    const target = event instanceof MouseEvent ? event : (event as TouchEvent).touches[0];
    if (!target) return;

    const paneEl = document.querySelector(".react-flow__pane");
    if (!paneEl) return;
    const paneRect = paneEl.getBoundingClientRect();

    // Choose the node type first (same as the Add step button); the type picker
    // creates and wires the node once a type is chosen.
    setPendingConnect({
      fromNodeId,
      position: { x: target.clientX - paneRect.left - 112, y: target.clientY - paneRect.top - 40 },
    });
    setTypePickerOpen(true);
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

    // Read the existing node's raw config so we can forward fields that the
    // modal does not manage (documentTemplateFields, documentTemplateStructuredContent).
    // These are written by the template upload endpoint; omitting them here would
    // wipe them from the DB on every conversational-node save.
    const existingNodeConfig = ((rfNodes.find((n) => n.id === editingNodeId)?.data as { config?: Record<string, unknown> })?.config ?? {});
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
          customRequestFieldKeys: values.customRequestFieldKeys,
          notifyOnComplete: values.notifyOnComplete,
        };
      }
      if (values.type === "scheduled") {
        return { ...scheduledConfigFromValues(values), notifyOnComplete: values.notifyOnComplete };
      }
      if (values.type === "approval") {
        return {
          approverSource: values.approverSource,
          roleHint: values.roleHint,
          instructions: values.approvalInstructions,
          notifyOnComplete: values.notifyOnComplete,
        };
      }
      const hasTemplate = values.outputType === "generate_document" && !!values.documentTemplatePath;
      return {
        aiInstruction: values.aiInstruction,
        doneWhen: values.neverDone ? "" : values.doneWhen,
        neverDone: values.neverDone,
        outputType: values.outputType,
        documentTemplatePath: values.documentTemplatePath ?? null,
        documentTemplateFilename: values.documentTemplateFilename ?? null,
        documentTemplateContent: values.documentTemplateContent ?? null,
        documentTemplateFields: hasTemplate ? (existingNodeConfig.documentTemplateFields ?? null) : null,
        documentTemplateStructuredContent: hasTemplate ? (existingNodeConfig.documentTemplateStructuredContent ?? null) : null,
        allowManualEdit: values.allowManualEdit,
        notifyOnComplete: values.notifyOnComplete,
      };
    };
    const config: Record<string, unknown> = buildConfig();

    try {
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
      // The node has been saved with the author's content, so it is no longer a
      // throwaway: cancelling later must not delete it.
      setCreatedNodeId(null);
      setConfigOpen(false);
      setEditingNodeId(null);
    } finally {
      setIsSavingConfig(false);
    }
  }, [editingNodeId, flowId, rfNodes, updateNodeMutation]);

  const handleAddStep = useCallback(() => {
    setTypePickerOpen(true);
  }, []);

  const handleSelectNodeType = useCallback((type: NodeConfigType) => {
    setTypePickerOpen(false);
    if (pendingConnect) {
      const { fromNodeId, position } = pendingConnect;
      setPendingConnect(null);
      void createAndEditNode(type, position, fromNodeId);
      return;
    }
    const xOffset = rfNodes.length > 0 ? (rfNodes[rfNodes.length - 1]?.position.x ?? 0) + 280 : 200;
    void createAndEditNode(type, { x: xOffset, y: 200 });
  }, [pendingConnect, rfNodes, createAndEditNode]);

  const handleConfigClose = useCallback(() => {
    // The author backed out of a step they just created; remove it so the
    // canvas is not littered with empty placeholder nodes.
    if (createdNodeId) {
      const orphanId = createdNodeId;
      void deleteNodeMutation.mutateAsync({ nodeId: orphanId, flowId }).catch(() => undefined);
      setRfNodes((nds) => nds.filter((n) => n.id !== orphanId));
      setRfEdges((eds) => eds.filter((e) => e.source !== orphanId && e.target !== orphanId));
      setCreatedNodeId(null);
    }
    setConfigOpen(false);
    setEditingNodeId(null);
  }, [createdNodeId, deleteNodeMutation, flowId]);

  const handleUploadTemplate = useCallback(async (
    file: File,
    _currentValues: NodeConfigValues,
  ): Promise<{ path: string; filename: string; documentTemplateContent: string | null } | { error: string; code?: string }> => {
    if (!editingNodeId) {
      return { error: "Save the step first before uploading a template." };
    }
    const nodeId = editingNodeId;

    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`/api/flows/${flowId}/nodes/${nodeId}/template`, {
      method: "POST",
      body: formData,
    });
    const data = await res.json() as { path?: string; filename?: string; documentTemplateContent?: string | null; documentTemplateFields?: TemplateField[]; error?: string; code?: string };
    if (!res.ok || data.error) {
      return { error: data.error ?? "Upload failed", code: data.code };
    }
    // Reflect the whole upload result in rfNodes immediately: the fields so
    // priorStepFields picks them up, and the filename/path/content so the modal's
    // initialValues re-sync (keyed on rfNodes) doesn't wipe the just-set filename
    // pill before the next save.
    setRfNodes((nds) =>
      nds.map((n) => {
        if (n.id !== nodeId) return n;
        const nodeConfig = ((n.data as { config?: Record<string, unknown> }).config ?? {});
        return {
          ...n,
          data: {
            ...n.data,
            config: {
              ...nodeConfig,
              documentTemplatePath: data.path ?? null,
              documentTemplateFilename: data.filename ?? null,
              documentTemplateContent: data.documentTemplateContent ?? null,
              ...(data.documentTemplateFields ? { documentTemplateFields: data.documentTemplateFields } : {}),
            },
          },
        };
      }),
    );
    return { path: data.path!, filename: data.filename!, documentTemplateContent: data.documentTemplateContent ?? null };
  }, [editingNodeId, flowId]);

  const handleNodeDelete = useCallback(async () => {
    if (!editingNodeId) return;
    await deleteNodeMutation.mutateAsync({ nodeId: editingNodeId, flowId });
    setRfNodes((nds) => nds.filter((n) => n.id !== editingNodeId));
    setRfEdges((eds) =>
      eds.filter((e) => e.source !== editingNodeId && e.target !== editingNodeId),
    );
    setCreatedNodeId(null);
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
      const stepName = (node.data as { name?: string }).name ?? "Step";
      const stepLabel = `${step}. ${stepName}`;
      for (const field of fields) {
        result.push({
          nodeId: node.id,
          stepLabel,
          stepNumber: Number(step) || 0,
          stepName,
          field: { key: field.key, label: field.label, type: field.type },
        });
      }
    }
    return result;
  }, [editingNodeId, rfNodes, stepNumbers]);

  // A reference is stale when a step binds a value (a request field or schedule
  // anchor) to a prior-step field that no longer exists in the graph.
  const staleReferences = useMemo<string[]>(() => {
    const declared = new Set<string>();
    for (const node of rfNodes) {
      const config = ((node.data as { config?: Record<string, unknown> }).config ?? {}) as Record<string, unknown>;
      const fields =
        node.type === "autoNode"
          ? readFields(config.responseFields)
          : node.type === "conversationalNode" && config.outputType === "generate_document"
            ? readFields(config.documentTemplateFields)
            : [];
      for (const field of fields) declared.add(`${node.id}:${field.key}`);
    }

    const stale: string[] = [];
    for (const node of rfNodes) {
      const config = ((node.data as { config?: Record<string, unknown> }).config ?? {}) as Record<string, unknown>;
      const name = (node.data as { name?: string }).name ?? "Step";
      const requestFieldValues =
        (config.requestFieldValues as Record<string, FieldValueSource> | undefined) ?? {};
      for (const [key, source] of Object.entries(requestFieldValues)) {
        if (source?.kind === "step_field" && !declared.has(`${source.nodeId}:${source.fieldKey}`)) {
          stale.push(`"${name}" field "${key}"`);
        }
      }
      const anchorSource = config.anchorSource as FieldValueSource | undefined;
      if (anchorSource?.kind === "step_field" && !declared.has(`${anchorSource.nodeId}:${anchorSource.fieldKey}`)) {
        stale.push(`"${name}" schedule anchor`);
      }
    }
    return stale;
  }, [rfNodes]);

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
              : editingNode?.type === "approvalNode"
                ? "approval"
                : "conversational",
        approverSource:
          (editingConfig.approverSource as
            | "first_level_supervisor"
            | "second_level_supervisor"
            | "dynamic"
            | undefined) ?? "first_level_supervisor",
        roleHint: (editingConfig.roleHint as string | null) ?? "",
        approvalInstructions: (editingConfig.instructions as string | null) ?? "",
        aiInstruction: (editingConfig.aiInstruction as string | null) ?? editingData.aiInstruction ?? "",
        doneWhen: (editingConfig.doneWhen as string | null) ?? "",
        neverDone: Boolean(editingConfig.neverDone),
        outputType: (editingConfig.outputType as "conversation_only" | "generate_document" | null) ?? "conversation_only",
        documentTemplatePath: (editingConfig.documentTemplatePath as string | null) ?? null,
        documentTemplateFilename: (editingConfig.documentTemplateFilename as string | null) ?? null,
        documentTemplateContent: (editingConfig.documentTemplateContent as string | null) ?? null,
        allowManualEdit: (editingConfig.allowManualEdit as boolean | undefined) ?? true,
        instruction: (editingConfig.instruction as string | null) ?? "",
        executor: (editingConfig.executor as "n8n" | "mock" | undefined) ?? "n8n",
        workflowId: (editingConfig.workflowId as string | null) ?? null,
        webhookUrl: (editingConfig.webhookUrl as string | null) ?? "",
        requestFields: readFields(editingConfig.requestFields),
        requestFieldValues:
          (editingConfig.requestFieldValues as Record<string, FieldValueSource> | undefined) ?? {},
        responseFields: readFields(editingConfig.responseFields),
        customRequestFieldKeys:
          (editingConfig.customRequestFieldKeys as string[] | undefined) ?? [],
        notifyOnComplete:
          (editingConfig.notifyOnComplete as boolean | undefined) ??
          (editingNode?.type === "scheduledNode"),
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
        {staleReferences.length > 0 && (
          <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 max-w-[90%] -translate-x-1/2 rounded-[9px] border border-[#e7c200] bg-[#fff8e1] px-4 py-2 text-center text-[12px] text-[#8a6d00] shadow-md">
            ⚠ Some steps reference data that no longer exists: {staleReferences.join(", ")}. Re-open them to fix.
          </div>
        )}
      </div>

      <ContextDocsStrip
        flowId={flowId}
        docs={contextDocs}
        onDocsChange={setContextDocs}
      />

      <NodeTypePickerModal
        open={typePickerOpen}
        autoNodeEnabled={autoNodeEnabled}
        scheduledNodeEnabled={scheduledNodeEnabled}
        onSelect={handleSelectNodeType}
        onClose={() => {
          setTypePickerOpen(false);
          setPendingConnect(null);
        }}
      />

      <NodeConfigModal
        open={configOpen}
        flowId={flowId}
        initialValues={initialConfigValues}
        onSave={handleConfigSave}
        onDelete={editingNodeId ? handleNodeDelete : undefined}
        onClose={handleConfigClose}
        isSaving={isSavingConfig}
        priorStepFields={priorStepFields}
        onUploadTemplate={editingNodeId ? handleUploadTemplate : undefined}
      />
      <VersionHistoryDialog
        flowId={flowId}
        open={versionHistoryOpen}
        onOpenChange={setVersionHistoryOpen}
        onRestored={() => void canvasQuery.refetch()}
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
