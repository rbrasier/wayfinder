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
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
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
import { ContextDocsStrip } from "@/components/canvas/context-docs-strip";
import { FlowCanvasViewport } from "@/components/canvas/flow-canvas-viewport";
import type { NodeConfigType, NodeConfigValues } from "@/components/canvas/node-config-modal";
import { NodeConfigModal } from "@/components/canvas/node-config-modal";
import { NodeTypePickerModal } from "@/components/canvas/node-type-picker-modal";
import { VersionHistoryDialog } from "@/components/canvas/version-history-dialog";
import { STEP_TYPE_ACCENT } from "@/components/canvas/node-styles";
import { defaultConfigForType } from "@/components/canvas/node-defaults";
import { scheduledConfigFromValues } from "@/components/canvas/scheduled-node-config";
import { approvalConfigFromValues } from "@/components/canvas/approval-config-mapping";
import { FlowMetadataDialog, type FlowMetadataValues } from "@/components/flow/flow-metadata-dialog";
import { FlowExplainerCarousel } from "@/components/tour/flow-explainer-carousel";
import { parseTourStage, TOUR_PARAM } from "@/components/tour/tour-stage";
import { trpc } from "@/trpc/client";
import type { ConversationalNodeData } from "@/components/canvas/conversational-node";
import type {
  FieldValueSource,
  FlowContextDoc,
  PermissionKey,
  TemplateField,
} from "@rbrasier/domain";
import { computeStepNumbers } from "@/lib/flow-utils";
import type { NextStepAnchor } from "@/lib/canvas/canvas-guidance";
import {
  CANVAS_DEBOUNCE_MS as DEBOUNCE_MS,
  readFields,
  toRfEdge,
  toRfNode,
} from "@/lib/canvas/rf-adapters";
import { BranchRuleModal } from "@/components/canvas/branch-rule-modal";
import { FlowConfigHeader } from "./_flow-config-header";
import { useBranchRules } from "./_use-branch-rules";
import { usePriorStepViews } from "./_use-prior-step-views";
import { configValuesForNode } from "./_node-config-values";

// What the template endpoints return on success. Shared by the direct upload and
// the guided annotation modal so both apply the result identically.
interface TemplateUploadResult {
  path?: string;
  filename?: string;
  documentTemplateContent?: string | null;
  documentTemplateFields?: TemplateField[];
  documentTemplateFormat?: "docx" | "xlsx";
  spreadsheetTemplateMode?: "tags" | "header" | null;
}

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
  const [flowVisibility, setFlowVisibility] = useState<"private" | "global" | "group" | "organisation">("private");
  const [flowGroupIds, setFlowGroupIds] = useState<string[]>([]);
  const [expertRole, setExpertRole] = useState<string>("");
  const meQuery = trpc.user.me.useQuery();
  const isAdmin = meQuery.data?.isAdmin ?? false;
  const canPublishToEveryone =
    isAdmin ||
    ((meQuery.data?.permissions ?? []) as PermissionKey[]).includes("workflow:publish_to_everyone");
  const autoNodeEnabled = trpc.featureFlag.isEnabledForMe.useQuery({ key: "auto_node" }).data ?? false;
  const scheduledNodeEnabled =
    trpc.featureFlag.isEnabledForMe.useQuery({ key: "scheduled_node" }).data ?? false;
  const mcpEnabled = trpc.featureFlag.isEnabledForMe.useQuery({ key: "mcp" }).data ?? false;
  const skillsEnabled = trpc.featureFlag.isEnabledForMe.useQuery({ key: "skills" }).data ?? false;
  const [editingMetadata, setEditingMetadata] = useState(false);

  const [configOpen, setConfigOpen] = useState(false);
  const [typePickerOpen, setTypePickerOpen] = useState(false);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  // The node just created by the picker / a drag-out. If the author cancels the
  // config modal it is deleted, so picking a type and backing out leaves no
  // orphan — while still being a real, persisted node during editing (so
  // document uploads work without an explicit first save).
  const [createdNodeId, setCreatedNodeId] = useState<string | null>(null);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  // A step waiting on a type: where it goes, and what it hangs off. A connector
  // dragged into blank space always names its source; the canvas's next-step
  // prompt leaves it null when the graph has more than one open branch and no
  // single parent is correct. The type picker resolves the type first, mirroring
  // the Add step button.
  const [pendingConnect, setPendingConnect] = useState<{
    fromNodeId: string | null;
    position: { x: number; y: number };
  } | null>(null);
  const [flowMenuOpen, setFlowMenuOpen] = useState(false);
  // The welcome tour lands here with the explainer stage set (ADR-056 §2); the
  // carousel also replays from the flow menu and the empty-canvas link. Its
  // closing call to action points at the first-step button until that is used.
  const searchParams = useSearchParams();
  const [explainerOpen, setExplainerOpen] = useState(
    parseTourStage(searchParams.get(TOUR_PARAM)) === "flow-explainer",
  );
  const [highlightFirstStep, setHighlightFirstStep] = useState(false);
  const closeExplainer = (pointAtFirstStep: boolean) => {
    setExplainerOpen(false);
    if (searchParams.has(TOUR_PARAM)) router.replace(`/flows/${flowId}/config`);
    setHighlightFirstStep(pointAtFirstStep);
  };
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const flowMenuRef = useRef<HTMLDivElement>(null);

  // Tracks whether the live definition diverges from the published version, so
  // the header can show a "Draft · unpublished" indicator and the menu can offer
  // "Publish new version". Seeded from the server and flipped true on every edit.
  const versionStatusQuery = trpc.flowVersion.status.useQuery({ flowId });
  const [hasUnpublishedChanges, setHasUnpublishedChanges] = useState(false);
  useEffect(() => {
    if (versionStatusQuery.data) setHasUnpublishedChanges(versionStatusQuery.data.hasOpenDraft);
  }, [versionStatusQuery.data]);
  const markEdited = useCallback(() => setHasUnpublishedChanges(true), []);

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
  const setBranchRuleMutation = trpc.flow.edge.setBranchRule.useMutation();

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
    setFlowVisibility(data.flow.visibility.kind);
    setFlowGroupIds(
      data.flow.visibility.kind === "group" ? data.flow.visibility.groupIds : [],
    );
    setExpertRole(data.flow.expertRole ?? "");
    if (data.nodes.length > 3) {
      setTimeout(() => { fitView({ padding: 0.2, maxZoom: 1 }); }, 100);
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
      type: "branchRuleEdge",
      markerEnd: { type: MarkerType.ArrowClosed },
      source: connection.source,
      target: connection.target,
      data: {},
    };
    setRfEdges((eds) => addEdge(edge, eds));
    markEdited();
    void createEdgeMutation.mutateAsync({
      flowId,
      fromNodeId: connection.source,
      toNodeId: connection.target,
    }).then((created) => {
      setRfEdges((eds) => eds.map((e) => (e.id === edge.id ? { ...e, id: created.id } : e)));
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
          { id: edge.id, source: edge.fromNodeId, target: edge.toNodeId, type: "branchRuleEdge", markerEnd: { type: MarkerType.ArrowClosed }, data: {} },
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
      void updatePositionMutation.mutateAsync({ nodeId: node.id, flowId, x: node.position.x, y: node.position.y });
      positionTimers.current.delete(node.id);
      markEdited();
    }, DEBOUNCE_MS);
    positionTimers.current.set(node.id, timer);
  }, [updatePositionMutation, flowId, markEdited]);

  // Reflect a template result in rfNodes immediately: the fields so
  // priorStepFields picks them up, and the filename/path/content so the modal's
  // initialValues re-sync (keyed on rfNodes) doesn't wipe the just-set filename
  // pill before the next save. Shared by the direct upload path and the guided
  // annotation modal, which reach the same endpoint by different routes.
  const applyTemplateResult = useCallback((data: TemplateUploadResult) => {
    if (!editingNodeId) return;
    setRfNodes((nds) =>
      nds.map((n) => {
        if (n.id !== editingNodeId) return n;
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
              documentTemplateFormat: data.documentTemplateFormat ?? "docx",
              spreadsheetTemplateMode: data.spreadsheetTemplateMode ?? null,
              ...(data.documentTemplateFields ? { documentTemplateFields: data.documentTemplateFields } : {}),
            },
          },
        };
      }),
    );
  }, [editingNodeId, setRfNodes]);

  const handleUploadTemplate = useCallback(async (file: File, _currentValues: NodeConfigValues): Promise<{ path: string; filename: string; documentTemplateContent: string | null; documentTemplateFormat?: "docx" | "xlsx"; spreadsheetTemplateMode?: "tags" | "header" | null } | { error: string; code?: string }> => {
    if (!editingNodeId) {
      return { error: "Save the step first before uploading a template." };
    }
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`/api/flows/${flowId}/nodes/${editingNodeId}/template`, {
      method: "POST",
      body: formData,
    });
    const data = await res.json() as TemplateUploadResult & { error?: string; code?: string };
    if (!res.ok || data.error) {
      return { error: data.error ?? "Upload failed", code: data.code };
    }
    applyTemplateResult(data);
    return {
      path: data.path!,
      filename: data.filename!,
      documentTemplateContent: data.documentTemplateContent ?? null,
      documentTemplateFormat: data.documentTemplateFormat ?? "docx",
      spreadsheetTemplateMode: data.spreadsheetTemplateMode ?? null,
    };
  }, [editingNodeId, flowId, applyTemplateResult]);

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
        return approvalConfigFromValues(values);
      }
      if (values.type === "mcp") {
        return {
          instruction: values.instruction,
          serverId: values.mcpServerId,
          toolName: values.mcpToolName,
          requestFields: values.requestFields,
          requestFieldValues: values.requestFieldValues,
          responseFields: values.responseFields,
        };
      }
      const hasTemplate = values.outputType === "generate_document" && !!values.documentTemplatePath;
      return {
        aiInstruction: values.aiInstruction,
        doneWhen: values.neverDone ? "" : values.doneWhen,
        neverDone: values.neverDone,
        outputType: values.outputType,
        structuredFields: values.outputType === "structured" ? values.structuredFields : null,
        documentTemplatePath: values.documentTemplatePath ?? null,
        documentTemplateFilename: values.documentTemplateFilename ?? null,
        documentTemplateContent: values.documentTemplateContent ?? null,
        documentTemplateFields: hasTemplate ? (existingNodeConfig.documentTemplateFields ?? null) : null,
        documentTemplateStructuredContent: hasTemplate ? (existingNodeConfig.documentTemplateStructuredContent ?? null) : null,
        documentTemplateFormat: hasTemplate ? (existingNodeConfig.documentTemplateFormat ?? null) : null,
        spreadsheetTemplateMode: hasTemplate ? (existingNodeConfig.spreadsheetTemplateMode ?? null) : null,
        allowManualEdit: values.allowManualEdit,
        requireConfirmation: values.neverDone ? false : values.requireConfirmation,
        skillRefs: values.skillRefs,
        allowedMcpToolRefs: values.allowedMcpToolRefs,
        notifyOnComplete: values.notifyOnComplete,
      };
    };
    const config: Record<string, unknown> = buildConfig();

    try {
      await updateNodeMutation.mutateAsync({ nodeId: editingNodeId, flowId, name: values.name, colour: values.colour, type: values.type, config });
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

  // The canvas's next-step prompt. It already knows where the step belongs and
  // whether there is an unambiguous parent to join it to, so it hands both
  // straight to the drag-out path rather than adding a second way to create one.
  const handleAddNextStep = useCallback((anchor: NextStepAnchor) => {
    setPendingConnect({ fromNodeId: anchor.connectFromNodeId, position: anchor.position });
    setTypePickerOpen(true);
  }, []);

  const handleSelectNodeType = useCallback((type: NodeConfigType) => {
    setTypePickerOpen(false);
    if (pendingConnect) {
      const { fromNodeId, position } = pendingConnect;
      setPendingConnect(null);
      void createAndEditNode(type, position, fromNodeId ?? undefined);
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

  const handleNodeDelete = useCallback(async () => {
    if (!editingNodeId) return;
    await deleteNodeMutation.mutateAsync({ nodeId: editingNodeId, flowId });
    setRfNodes((nds) => nds.filter((n) => n.id !== editingNodeId));
    setRfEdges((eds) => eds.filter((e) => e.source !== editingNodeId && e.target !== editingNodeId));
    setCreatedNodeId(null);
    setConfigOpen(false);
    setEditingNodeId(null);
    markEdited();
    toast.success("Step deleted");
  }, [editingNodeId, deleteNodeMutation, flowId, markEdited]);

  // Fork-aware labels ("2a", "2b") shared with the runtime chat step-rail, so
  // the editor and the running flow number steps identically.
  const stepNumbers = useMemo(() => {
    const adaptedEdges = rfEdges.map((e) => ({ fromNodeId: e.source, toNodeId: e.target }));
    return computeStepNumbers(rfNodes, adaptedEdges);
  }, [rfNodes, rfEdges]);

  const displayNodes = useMemo(
    () =>
      rfNodes.map((n) => ({
        ...n,
        data: { ...(n.data as ConversationalNodeData), stepNumber: stepNumbers.get(n.id) ?? null },
      })),
    [rfNodes, stepNumbers],
  );

  const persistBranchRule = useCallback(
    (edgeId: string, rule: string | null) => {
      void setBranchRuleMutation.mutateAsync({ edgeId, flowId, rule });
    },
    [setBranchRuleMutation, flowId],
  );

  const { displayEdges, branchRuleTarget, saveBranchRule, closeBranchRule } = useBranchRules(
    rfNodes,
    rfEdges,
    setRfEdges,
    persistBranchRule,
    markEdited,
  );

  // Fields declared by steps before the one being edited — auto-node response
  // fields and conversational document-template fields — offered as value
  // sources for the current node's request fields / scheduled timestamp.
  const { priorStepFields, priorSteps, takenSignatureFieldKeys } = usePriorStepViews(
    rfNodes,
    stepNumbers,
    editingNodeId,
  );

  // A reference is stale when a step binds a value (a request field or a
  // schedule anchor) to a prior-step field that no longer exists in the graph —
  // e.g. the source step or field was deleted after the binding was authored.
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
  const initialConfigValues = configValuesForNode(editingNode);

  return (
    <div className="flex h-full flex-col">
      <FlowConfigHeader
        flowId={flowId}
        flowName={flowName}
        flowStatus={flowStatus}
        setFlowStatus={setFlowStatus}
        flowVisibility={flowVisibility}
        setFlowVisibility={setFlowVisibility}
        flowGroupIds={flowGroupIds}
        setFlowGroupIds={setFlowGroupIds}
        hasUnpublishedChanges={hasUnpublishedChanges}
        setHasUnpublishedChanges={setHasUnpublishedChanges}
        latestPublishedNumber={versionStatusQuery.data?.latestPublishedNumber ?? null}
        canPublishToEveryone={canPublishToEveryone}
        flowMenuOpen={flowMenuOpen}
        setFlowMenuOpen={setFlowMenuOpen}
        flowMenuRef={flowMenuRef}
        onAddStep={handleAddStep}
        onShowExplainer={() => setExplainerOpen(true)}
        updateFlowMutation={updateFlowMutation}
        refetchVersionStatus={() => void versionStatusQuery.refetch()}
        setEditingMetadata={setEditingMetadata}
        setVersionHistoryOpen={setVersionHistoryOpen}
        setDeleteConfirmOpen={setDeleteConfirmOpen}
      />

      <FlowCanvasViewport
        nodes={displayNodes}
        edges={displayEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        onNodeClick={onNodeClick}
        onNodeDragStop={onNodeDragStop}
        onAddStep={() => {
          setHighlightFirstStep(false);
          handleAddStep();
        }}
        onAddNextStep={handleAddNextStep}
        onShowExplainer={() => setExplainerOpen(true)}
        highlightFirstStep={highlightFirstStep}
        staleReferences={staleReferences}
      />

      <FlowExplainerCarousel
        open={explainerOpen}
        hasSteps={rfNodes.length > 0}
        onClose={() => closeExplainer(false)}
        onFinish={() => closeExplainer(rfNodes.length === 0)}
      />

      <BranchRuleModal
        target={branchRuleTarget}
        onSave={saveBranchRule}
        onClose={closeBranchRule}
      />

      <ContextDocsStrip flowId={flowId} docs={contextDocs} onDocsChange={setContextDocs} />

      <NodeTypePickerModal
        open={typePickerOpen}
        autoNodeEnabled={autoNodeEnabled}
        scheduledNodeEnabled={scheduledNodeEnabled}
        mcpNodeEnabled={mcpEnabled}
        onSelect={handleSelectNodeType}
        onClose={() => {
          setTypePickerOpen(false);
          setPendingConnect(null);
        }}
      />

      <NodeConfigModal
        open={configOpen}
        flowId={flowId}
        nodeId={editingNodeId}
        onTemplateApplied={applyTemplateResult}
        initialValues={initialConfigValues}
        onSave={handleConfigSave}
        onDelete={editingNodeId ? handleNodeDelete : undefined}
        onClose={handleConfigClose}
        isSaving={isSavingConfig}
        priorStepFields={priorStepFields}
        priorSteps={priorSteps}
        takenSignatureFieldKeys={takenSignatureFieldKeys}
        skillsEnabled={skillsEnabled}
        mcpEnabled={mcpEnabled}
        onUploadTemplate={editingNodeId ? handleUploadTemplate : undefined}
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

      <Dialog open={deleteConfirmOpen} onOpenChange={(open) => !open && setDeleteConfirmOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete flow?</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody>
            <p className="text-[13px] leading-[1.55] text-[#5c574c]">
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
