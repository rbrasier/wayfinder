"use client";

import {
  MarkerType,
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ContextDocsStrip } from "@/components/canvas/context-docs-strip";
import { FlowCanvasViewport } from "@/components/canvas/flow-canvas-viewport";
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
import type { ConversationalNodeData } from "@/components/canvas/conversational-node";
import type { FieldValueSource, FlowContextDoc, PriorStepField, TemplateField } from "@rbrasier/domain";
import { computeStepNumbers } from "@/lib/flow-utils";
import {
  CANVAS_DEBOUNCE_MS as DEBOUNCE_MS,
  readFields,
  toRfEdge,
  toRfNode,
} from "@/lib/canvas/rf-adapters";
import { FlowConfigHeader } from "./_flow-config-header";

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
  const editNameInputRef = useRef<HTMLInputElement>(null);

  // Move focus to the rename field when it is revealed (replaces autoFocus,
  // which jsx-a11y/no-autofocus forbids). Gated on editingName so it only fires
  // in response to the user clicking the name, never on page load.
  useEffect(() => {
    if (editingName) editNameInputRef.current?.focus();
  }, [editingName]);

  // Tracks whether the live definition diverges from the published version, so
  // the header can show a "Draft · unpublished" indicator and the menu can offer
  // "Publish new version". Seeded from the server and flipped true on every edit.
  const versionStatusQuery = trpc.flowVersion.status.useQuery({ flowId });
  const [hasUnpublishedChanges, setHasUnpublishedChanges] = useState(false);
  useEffect(() => {
    if (versionStatusQuery.data) setHasUnpublishedChanges(versionStatusQuery.data.hasOpenDraft);
  }, [versionStatusQuery.data]);
  const markEdited = useCallback(() => setHasUnpublishedChanges(true), []);
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
    if (deletions.length > 0) markEdited();
  }, [deleteEdgeMutation, flowId, markEdited]);

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
    markEdited();
    void createEdgeMutation.mutateAsync({
      flowId,
      fromNodeId: connection.source,
      toNodeId: connection.target,
    }).then((created) => {
      setRfEdges((eds) =>
        eds.map((e) => (e.id === edge.id ? { ...e, id: created.id } : e)),
      );
    });
  }, [createEdgeMutation, flowId, markEdited]);

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
      markEdited();
    },
    [createNodeMutation, createEdgeMutation, flowId, markEdited],
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
      markEdited();
    }, DEBOUNCE_MS);
    positionTimers.current.set(node.id, timer);
  }, [updatePositionMutation, flowId, markEdited]);

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
        requireConfirmation: values.neverDone ? false : values.requireConfirmation,
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
      markEdited();
    } finally {
      setIsSavingConfig(false);
    }
  }, [editingNodeId, flowId, rfNodes, updateNodeMutation, markEdited]);

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
    markEdited();
    toast.success("Step deleted");
  }, [editingNodeId, deleteNodeMutation, flowId, markEdited]);

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
        requireConfirmation: Boolean(editingConfig.requireConfirmation),
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
      <FlowConfigHeader
        flowId={flowId}
        flowName={flowName}
        setFlowName={setFlowName}
        canvasFlowName={canvasQuery.data?.flow.name ?? ""}
        flowStatus={flowStatus}
        setFlowStatus={setFlowStatus}
        flowVisibility={flowVisibility}
        setFlowVisibility={setFlowVisibility}
        hasUnpublishedChanges={hasUnpublishedChanges}
        setHasUnpublishedChanges={setHasUnpublishedChanges}
        latestPublishedNumber={versionStatusQuery.data?.latestPublishedNumber ?? null}
        editingName={editingName}
        setEditingName={setEditingName}
        editNameInputRef={editNameInputRef}
        actionsMenuOpen={actionsMenuOpen}
        setActionsMenuOpen={setActionsMenuOpen}
        publishSubOpen={publishSubOpen}
        setPublishSubOpen={setPublishSubOpen}
        actionsMenuRef={actionsMenuRef}
        onAddStep={handleAddStep}
        updateFlowMutation={updateFlowMutation}
        refetchVersionStatus={() => void versionStatusQuery.refetch()}
        setVersionHistoryOpen={setVersionHistoryOpen}
      />

      <FlowCanvasViewport
        nodes={rfNodesWithNumbers}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        onNodeClick={onNodeClick}
        onNodeDragStop={onNodeDragStop}
        staleReferences={staleReferences}
      />

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
        onRestored={() => {
          // A restore realigns the live flow with the chosen version, clearing
          // any open draft — refresh both the canvas and the version indicator.
          setHasUnpublishedChanges(false);
          void canvasQuery.refetch();
          void versionStatusQuery.refetch();
        }}
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
