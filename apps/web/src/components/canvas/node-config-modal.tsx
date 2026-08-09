"use client";

import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { Eye, Pencil } from "lucide-react";
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
import { deriveFieldKey } from "@rbrasier/domain";
import type { FieldValueSource, PriorStepField, TemplateField } from "@rbrasier/domain";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/trpc/client";
import { TemplateTagsHelpDialog } from "./template-tags-help-dialog";
import { parseFieldLines } from "./template-field-editor";
import { N8nExtractionInfoDialog } from "./n8n-extraction-info-dialog";
import { SkillPickerModal } from "./skill-picker-modal";
import { McpPickerModal } from "./mcp-picker-modal";
import { TEMPLATE_COMPLETE_SENTINEL, doneWhenForOutputType } from "./output-type";
import { NodeConfigModalConversational } from "./node-config-modal-conversational";
import { NodeConfigModalAdvanced } from "./node-config-modal-advanced";
import {
  TemplateAnnotationHost,
  templateValuesFrom,
  useTemplateUpload,
} from "./template-upload-controller";
import { NodeConfigModalAuto } from "./node-config-modal-auto";
import { NodeConfigModalScheduled } from "./node-config-modal-scheduled";
import { NodeConfigModalApproval } from "./node-config-modal-approval";
import { approvalAdvancedDefaultOpen, type PriorStep } from "./approval-node-config";
import { DEFAULT_VALUES, type NodeConfigValues } from "./node-config-values";

// Re-exported so the many call sites that import these from the modal keep
// working; the definitions now live in node-config-values.ts.
export type {
  ApproverSourceMode,
  NodeConfigType,
  NodeConfigValues,
} from "./node-config-values";
import { NodeConfigModalMcp } from "./node-config-modal-mcp";
import {
  CopyButton,
  StepColourPicker,
  buildCustomFields,
  isAdvancedField,
  type CustomRequestField,
} from "./node-config-modal-helpers";


interface NodeConfigModalProps {
  open: boolean;
  flowId: string;
  // The node being configured, once it exists. Null before the step's first
  // save, which is when template upload is unavailable anyway.
  nodeId?: string | null;
  // Applies a template result to the canvas state, so the guided annotation
  // modal's save reaches the same place a direct upload does.
  onTemplateApplied?: (result: {
    path?: string;
    filename?: string;
    documentTemplateContent?: string | null;
    documentTemplateFormat?: "docx" | "xlsx";
    spreadsheetTemplateMode?: "tags" | "header" | null;
  }) => void;
  initialValues?: Partial<NodeConfigValues>;
  onSave: (values: NodeConfigValues) => void;
  onDelete?: () => void;
  onClose: () => void;
  isSaving?: boolean;
  // Fields declared by steps earlier in the flow, offered as value sources.
  priorStepFields?: PriorStepField[];
  // Steps earlier in the flow, with their type — the approval subject and
  // return-target dropdowns list steps, not fields, so a conversational step
  // that declares nothing still has to appear.
  priorSteps?: PriorStep[];
  // Signature slots other approval steps already claim, so two nodes cannot
  // target one slot (ADR-043 §5).
  takenSignatureFieldKeys?: string[];
  // Power-user feature flags (ADR-022). When off, the conversational Skills and
  // MCP-tools sections are hidden — a step never offers a capability the author's
  // organisation has not enabled.
  skillsEnabled?: boolean;
  mcpEnabled?: boolean;
  onUploadTemplate?: (file: File, currentValues: NodeConfigValues) => Promise<{ path: string; filename: string; documentTemplateContent: string | null; documentTemplateFormat?: "docx" | "xlsx"; spreadsheetTemplateMode?: "tags" | "header" | null } | { error: string; code?: string }>;
}


export function NodeConfigModal({
  open,
  flowId,
  nodeId = null,
  onTemplateApplied,
  initialValues,
  onSave,
  onDelete,
  onClose,
  isSaving = false,
  priorStepFields = [],
  priorSteps = [],
  takenSignatureFieldKeys = [],
  skillsEnabled = false,
  mcpEnabled = false,
  onUploadTemplate,
}: NodeConfigModalProps) {
  const utils = trpc.useUtils();
  const [values, setValues] = useState<NodeConfigValues>({ ...DEFAULT_VALUES, ...initialValues });
  // Raw `Label (annotations)` lines edited in the field editors (mock executor).
  const [requestLines, setRequestLines] = useState<string[]>([]);
  const [responseLines, setResponseLines] = useState<string[]>([]);
  // Raw `Label (annotations)` lines for a structured conversation's field set.
  const [structuredLines, setStructuredLines] = useState<string[]>([]);
  const [customFields, setCustomFields] = useState<CustomRequestField[]>([]);
  const wasOpenRef = useRef(false);
  // Seed form state only on the open transition. `initialValues` is derived from
  // the canvas nodes and gets a fresh identity on every render — re-seeding on
  // its change would wipe the author's in-progress edits (e.g. output type) when
  // a template upload writes back to the nodes while the modal is still open.
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      const next = { ...DEFAULT_VALUES, ...initialValues };
      setValues(next);
      setRequestLines((next.requestFields ?? []).map((field) => field.raw));
      setResponseLines((next.responseFields ?? []).map((field) => field.raw));
      setStructuredLines((next.structuredFields ?? []).map((field) => field.raw));
      setCustomFields(buildCustomFields(next));
    }
    wasOpenRef.current = open;
  }, [open, initialValues]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [view, setView] = useState<"edit" | "preview">("edit");
  const [previewPrompt, setPreviewPrompt] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [helpDialogOpen, setHelpDialogOpen] = useState(false);
  const [infoVariant, setInfoVariant] = useState<"inputs" | "outputs">("inputs");
  const [infoOpen, setInfoOpen] = useState(false);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [mcpPickerOpen, setMcpPickerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const templateUpload = useTemplateUpload(fileInputRef, (result) => {
    setValues((current) => ({ ...current, ...templateValuesFrom(result) }));
    onTemplateApplied?.(result);
  });
  // The template controls stay disabled while the guided modal owns the file —
  // uploading itself now happens inside that modal, not here.
  const isUploading = templateUpload.isOpen;

  const set = <K extends keyof NodeConfigValues>(key: K, value: NodeConfigValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const isTemplateComplete = values.doneWhen === TEMPLATE_COMPLETE_SENTINEL;
  const doneWhenMode = values.neverDone ? "never" : isTemplateComplete ? "template" : "condition";

  const handleDoneWhenModeChange = (mode: string) => {
    if (mode === "never") {
      setValues((prev) => ({ ...prev, neverDone: true, doneWhen: "" }));
    } else if (mode === "template") {
      setValues((prev) => ({ ...prev, neverDone: false, doneWhen: TEMPLATE_COMPLETE_SENTINEL }));
    } else {
      setValues((prev) => ({
        ...prev,
        neverDone: false,
        doneWhen: prev.doneWhen === TEMPLATE_COMPLETE_SENTINEL ? "" : prev.doneWhen,
      }));
    }
  };

  const handleOutputTypeChange = (outputType: NodeConfigValues["outputType"]) =>
    setValues((prev) => ({
      ...prev,
      outputType,
      doneWhen: doneWhenForOutputType(outputType, prev),
    }));

  const isAuto = values.type === "auto";
  const isScheduled = values.type === "scheduled";
  const isApproval = values.type === "approval";
  const isConversational = values.type === "conversational";
  const isMcp = values.type === "mcp";
  const requestParsed = parseFieldLines(requestLines);
  const responseParsed = parseFieldLines(responseLines);
  // A structured conversation's field set — the `section` type is rejected.
  const structuredParsed = parseFieldLines(structuredLines, { disallowSection: true });

  const usesN8n = isAuto && values.executor === "n8n";

  // The Advanced section starts expanded where its contents are the author's
  // likely next action rather than a refinement.
  //
  // An unstructured conversation has no template and no field set, so "Done
  // when…" is the only thing deciding when the step ends — primary for that
  // output type, secondary for the other two. An approval on a step that
  // declares a signature is there to sign it.
  const advancedOpenWhen =
    (isConversational && values.outputType === "unstructured") ||
    (isApproval && approvalAdvancedDefaultOpen(priorStepFields, values.approvalSubjectNodeId));

  // Servers + discovered tools feed both the MCP node and the conversational
  // MCP-tools picker, so fetch once whenever either surface is visible.
  const mcpServersQuery = trpc.mcpServer.listWithTools.useQuery(undefined, {
    enabled: open && (isMcp || isConversational),
  });
  const mcpServers = mcpServersQuery.data ?? [];
  const selectedMcpServer = mcpServers.find((entry) => entry.server.id === values.mcpServerId) ?? null;
  const isToolAllowed = (serverId: string, toolName: string) =>
    values.allowedMcpToolRefs.some((ref) => ref.serverId === serverId && ref.toolName === toolName);
  const toggleAllowedTool = (serverId: string, toolName: string) => {
    const next = isToolAllowed(serverId, toolName)
      ? values.allowedMcpToolRefs.filter(
          (ref) => !(ref.serverId === serverId && ref.toolName === toolName),
        )
      : [...values.allowedMcpToolRefs, { serverId, toolName }];
    set("allowedMcpToolRefs", next);
  };

  // Selected skills are resolved to names for the chips beside the AI instructions.
  const skillsQuery = trpc.skill.list.useQuery(undefined, {
    enabled: open && isConversational && skillsEnabled,
  });
  const skillsById = new Map((skillsQuery.data ?? []).map((skill) => [skill.id, skill]));
  const removeSkill = (id: string) =>
    set(
      "skillRefs",
      values.skillRefs.filter((existing) => existing !== id),
    );

  const workflowsQuery = trpc.n8n.listWorkflows.useQuery(undefined, { enabled: open && usesN8n });
  const workflows = workflowsQuery.data ?? [];
  const selectedWorkflow = workflows.find((workflow) => workflow.id === values.workflowId) ?? null;

  // The full input/output schema for the selected workflow is fetched lazily —
  // only once a workflow is chosen — so the dropdown stays cheap.
  const schemaQuery = trpc.n8n.getWorkflowSchema.useQuery(
    { workflowId: values.workflowId ?? "" },
    { enabled: open && usesN8n && Boolean(values.workflowId) },
  );
  const schema = schemaQuery.data ?? null;

  const derivedInputs = usesN8n && schema ? schema.inputs : [];
  const regularDerivedInputs = derivedInputs.filter((field) => !isAdvancedField(field.key));
  const advancedDerivedInputs = derivedInputs.filter((field) => isAdvancedField(field.key));
  const derivedOutputs = usesN8n && schema ? schema.outputs : [];
  // Mock executor builds its request fields from the line editor.
  const mockRequestFields = requestParsed.fields;

  const setFieldValue = (key: string, next: FieldValueSource) =>
    setValues((prev) => ({
      ...prev,
      requestFieldValues: { ...prev.requestFieldValues, [key]: next },
    }));

  const addCustomField = () =>
    setCustomFields((prev) => [
      ...prev,
      { id: `cf-${Date.now()}-${prev.length}`, label: "", value: { kind: "ai" } },
    ]);
  const updateCustomLabel = (id: string, label: string) =>
    setCustomFields((prev) => prev.map((field) => (field.id === id ? { ...field, label } : field)));
  const updateCustomValue = (id: string, value: FieldValueSource) =>
    setCustomFields((prev) => prev.map((field) => (field.id === id ? { ...field, value } : field)));
  const removeCustomField = (id: string) =>
    setCustomFields((prev) => prev.filter((field) => field.id !== id));

  // Apply defaults for advanced fields the first time they appear:
  // - executionMode → "production" literal (n8n requires an explicit mode)
  // - headers / params / query / webhookUrl → no value (omit unless overridden)
  useEffect(() => {
    if (advancedDerivedInputs.length === 0) return;
    setValues((prev) => {
      const updates: Record<string, FieldValueSource> = {};
      for (const field of advancedDerivedInputs) {
        if (prev.requestFieldValues[field.key]) continue;
        if (field.key === "executionmode") {
          updates[field.key] = { kind: "literal", value: "production" };
        } else {
          updates[field.key] = { kind: "none" };
        }
      }
      if (Object.keys(updates).length === 0) return prev;
      return { ...prev, requestFieldValues: { ...prev.requestFieldValues, ...updates } };
    });
  }, [advancedDerivedInputs]);

  const selectWorkflow = (workflowId: string) => {
    const workflow = workflows.find((candidate) => candidate.id === workflowId);
    setValues((prev) => ({
      ...prev,
      workflowId: workflowId || null,
      webhookUrl: workflow?.webhookUrl ?? "",
    }));
  };

  const openInfo = (variant: "inputs" | "outputs") => {
    setInfoVariant(variant);
    setInfoOpen(true);
  };

  const conversationalValid =
    Boolean(values.name.trim()) &&
    Boolean(values.aiInstruction.trim()) &&
    (values.neverDone || isTemplateComplete || Boolean(values.doneWhen.trim())) &&
    (values.outputType !== "structured" || structuredParsed.valid);

  const autoValid =
    Boolean(values.name.trim()) &&
    Boolean(values.instruction.trim()) &&
    (values.executor !== "n8n" || (Boolean(values.workflowId) && Boolean(values.webhookUrl.trim()))) &&
    (usesN8n || (requestParsed.valid && responseParsed.valid));

  const scheduledValid =
    Boolean(values.name.trim()) &&
    (values.scheduleWhen === "ai" ||
      (values.scheduleWhen === "describe" && Boolean(values.scheduleDescribeText.trim())) ||
      (values.scheduleWhen === "specific" &&
        (values.scheduleModifier === "on" || Number(values.scheduleNumber) > 0)));

  const approvalValid = Boolean(values.name.trim()) && Boolean(values.approverSource);

  const mcpValid =
    Boolean(values.name.trim()) && Boolean(values.mcpServerId) && Boolean(values.mcpToolName);

  const canSave = isAuto
    ? autoValid
    : isScheduled
      ? scheduledValid
      : isApproval
        ? approvalValid
        : isMcp
          ? mcpValid
          : conversationalValid;

  const saveN8nAuto = (): NodeConfigValues => {
    const customTemplateFields: TemplateField[] = customFields
      .filter((field) => field.label.trim())
      .map((field) => {
        const label = field.label.trim();
        return { key: deriveFieldKey(label), label, type: "text", optional: false, raw: label };
      });
    const finalRequestFields = [...derivedInputs, ...customTemplateFields];
    const customKeys = customTemplateFields.map((field) => field.key);

    const mergedValues = { ...values.requestFieldValues };
    for (const field of customFields) {
      const label = field.label.trim();
      if (label) mergedValues[deriveFieldKey(label)] = field.value;
    }
    const keys = new Set(finalRequestFields.map((field) => field.key));
    const prunedValues = Object.fromEntries(
      Object.entries(mergedValues).filter(([key]) => keys.has(key)),
    );

    return {
      ...values,
      requestFields: finalRequestFields,
      requestFieldValues: prunedValues,
      responseFields: derivedOutputs,
      customRequestFieldKeys: customKeys,
    };
  };

  const saveMockAuto = (): NodeConfigValues => {
    const keys = new Set(mockRequestFields.map((field) => field.key));
    const prunedValues = Object.fromEntries(
      Object.entries(values.requestFieldValues).filter(([key]) => keys.has(key)),
    );
    return {
      ...values,
      requestFields: mockRequestFields,
      requestFieldValues: prunedValues,
      responseFields: responseParsed.fields,
      customRequestFieldKeys: [],
    };
  };

  // A structured conversation persists its parsed field set; any other output
  // type carries none, so switching away clears it (no data movement, ADR-038).
  const saveConversational = (): NodeConfigValues => ({
    ...values,
    structuredFields: values.outputType === "structured" ? structuredParsed.fields : [],
  });

  const saveMcp = (): NodeConfigValues => {
    const keys = new Set(requestParsed.fields.map((field) => field.key));
    const prunedValues = Object.fromEntries(
      Object.entries(values.requestFieldValues).filter(([key]) => keys.has(key)),
    );
    return {
      ...values,
      requestFields: requestParsed.fields,
      requestFieldValues: prunedValues,
      responseFields: responseParsed.fields,
    };
  };

  const handleSave = () => {
    if (!canSave) return;
    if (isAuto) {
      onSave(usesN8n ? saveN8nAuto() : saveMockAuto());
      return;
    }
    if (isMcp) {
      onSave(saveMcp());
      return;
    }
    if (isConversational) {
      onSave(saveConversational());
      return;
    }
    onSave(values);
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setConfirmDelete(false);
      setUploadError(null);
      setView("edit");
      setPreviewPrompt(null);
      setPreviewError(null);
      onClose();
    }
  };

  const handleToggleView = async () => {
    if (view === "preview") {
      setView("edit");
      return;
    }
    setIsLoadingPreview(true);
    setPreviewError(null);
    try {
      const result = await utils.flow.node.previewPrompt.fetch({
        flowId,
        aiInstruction: values.aiInstruction,
        doneWhen: values.doneWhen,
      });
      setPreviewPrompt(result.systemPrompt);
      setView("preview");
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : "Failed to load preview.");
      setView("preview");
    } finally {
      setIsLoadingPreview(false);
    }
  };

  // The picked file is handed to the guided annotation modal rather than
  // uploaded straight away: reading its placeholders and reviewing them both
  // happen before anything is persisted.
  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (!onUploadTemplate) return;
    setUploadError(null);
    templateUpload.handleFileChange(e);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl">
        {confirmDelete ? (
          <>
            <DialogHeader>
              <DialogTitle>Remove step?</DialogTitle>
              <DialogCloseButton />
            </DialogHeader>
            <DialogBody>
              <p className="text-[13px] leading-[1.55] text-[#5c574c]">
                This will delete the step and all its connected edges. This cannot be undone.
              </p>
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={onDelete}>
                Remove step
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Configure step</DialogTitle>
              {isConversational && (
                <button
                  type="button"
                  aria-label={view === "edit" ? "Preview prompt" : "Back to edit"}
                  className="ml-auto mr-1 rounded-md p-1 text-[#666055] transition-colors hover:bg-[#f5f3ee] hover:text-[#1c1b19] disabled:opacity-50"
                  onClick={handleToggleView}
                  disabled={isLoadingPreview}
                >
                  {view === "edit" ? <Eye size={15} /> : <Pencil size={15} />}
                </button>
              )}
              <DialogCloseButton />
            </DialogHeader>

            {view === "preview" ? (
              <>
                <DialogBody className="flex max-h-[70vh] flex-col gap-3 overflow-hidden">
                  {previewError ? (
                    <p className="text-[13px] text-[#a8324c]">{previewError}</p>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <p className="text-[12px] text-[#666055]">
                          System prompt sent to the AI for this step (read-only)
                        </p>
                        <CopyButton text={previewPrompt ?? ""} />
                      </div>
                      <pre className="flex-1 overflow-y-auto whitespace-pre-wrap rounded-[9px] border border-[#e7e3db] bg-[#faf9f7] p-3 font-mono text-[12px] leading-[1.6] text-[#1c1b19]">
                        {previewPrompt}
                      </pre>
                    </>
                  )}
                </DialogBody>
                <DialogFooter>
                  <Button type="button" variant="ghost" onClick={() => setView("edit")}>
                    ← Back to edit
                  </Button>
                </DialogFooter>
              </>
            ) : (
              <>
                <DialogBody className="max-h-[70vh] overflow-y-auto">
                  <div className="space-y-1">
                    <Label htmlFor="node-name">Step name</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="node-name"
                        required
                        value={values.name}
                        onChange={(e) => set("name", e.target.value)}
                        placeholder="e.g. Gather requirements"
                        className="flex-1"
                      />
                      <StepColourPicker value={values.colour} onChange={(hex) => set("colour", hex)} />
                    </div>
                  </div>

                  {isConversational && (
                    <NodeConfigModalConversational
                      values={values}
                      set={set}
                      handleOutputTypeChange={handleOutputTypeChange}
                      structuredLines={structuredLines}
                      onStructuredLinesChange={setStructuredLines}
                      onUploadTemplate={onUploadTemplate}
                      fileInputRef={fileInputRef}
                      handleFileChange={handleFileChange}
                      isUploading={isUploading}
                      onEditTemplateFields={templateUpload.editFields}
                      templateDownloadUrl={
                        nodeId && values.documentTemplatePath
                          ? `/api/flows/${flowId}/nodes/${nodeId}/template`
                          : null
                      }
                      uploadError={uploadError}
                      setUploadError={setUploadError}
                      onOpenHelpDialog={() => setHelpDialogOpen(true)}
                      skillsEnabled={skillsEnabled}
                      mcpEnabled={mcpEnabled}
                      skillsById={skillsById}
                      onOpenSkillPicker={() => setSkillPickerOpen(true)}
                      removeSkill={removeSkill}
                      onOpenMcpPicker={() => setMcpPickerOpen(true)}
                      toggleAllowedTool={toggleAllowedTool}
                    />
                  )}

                  {isAuto && (
                    <NodeConfigModalAuto
                      values={values}
                      set={set}
                      priorStepFields={priorStepFields}
                      workflowsQuery={workflowsQuery}
                      workflows={workflows}
                      selectedWorkflow={selectedWorkflow}
                      selectWorkflow={selectWorkflow}
                      schemaQuery={schemaQuery}
                      schema={schema}
                      usesN8n={usesN8n}
                      regularDerivedInputs={regularDerivedInputs}
                      advancedDerivedInputs={advancedDerivedInputs}
                      derivedInputs={derivedInputs}
                      derivedOutputs={derivedOutputs}
                      mockRequestFields={mockRequestFields}
                      requestLines={requestLines}
                      setRequestLines={setRequestLines}
                      responseLines={responseLines}
                      setResponseLines={setResponseLines}
                      customFields={customFields}
                      addCustomField={addCustomField}
                      updateCustomLabel={updateCustomLabel}
                      updateCustomValue={updateCustomValue}
                      removeCustomField={removeCustomField}
                      setFieldValue={setFieldValue}
                      openInfo={openInfo}
                    />
                  )}

                  {isScheduled && (
                    <NodeConfigModalScheduled
                      values={values}
                      set={set}
                      priorStepFields={priorStepFields}
                    />
                  )}

                  {isApproval && (
                    <NodeConfigModalApproval values={values} set={set} priorSteps={priorSteps} />
                  )}

                  {isMcp && (
                    <NodeConfigModalMcp
                      values={values}
                      set={set}
                      priorStepFields={priorStepFields}
                      mcpServers={mcpServers}
                      selectedMcpServer={selectedMcpServer}
                      mcpServersLoading={mcpServersQuery.isLoading}
                      requestLines={requestLines}
                      setRequestLines={setRequestLines}
                      responseLines={responseLines}
                      setResponseLines={setResponseLines}
                      requestFields={requestParsed.fields}
                      setFieldValue={setFieldValue}
                    />
                  )}

                  <NodeConfigModalAdvanced
                    values={values}
                    set={set}
                    isConversational={isConversational}
                    isApproval={isApproval}
                    openWhen={advancedOpenWhen}
                    doneWhenMode={doneWhenMode}
                    handleDoneWhenModeChange={handleDoneWhenModeChange}
                    priorSteps={priorSteps}
                    priorStepFields={priorStepFields}
                    takenSignatureFieldKeys={takenSignatureFieldKeys}
                  />
                </DialogBody>

                <DialogFooter className="flex-row items-center justify-between">
                  {onDelete && (
                    <Button type="button" variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>
                      Remove step
                    </Button>
                  )}
                  <div className="ml-auto flex gap-2">
                    <Button type="button" variant="ghost" onClick={onClose}>
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      onClick={handleSave}
                      disabled={isSaving || !canSave}
                    >
                      {isSaving ? "Saving…" : "Save"}
                    </Button>
                  </div>
                </DialogFooter>
              </>
            )}
          </>
        )}
      </DialogContent>
      <TemplateAnnotationHost
        controller={templateUpload}
        flowId={flowId}
        nodeId={nodeId}
        documentTemplateContent={values.documentTemplateContent}
      />
      <TemplateTagsHelpDialog
        open={helpDialogOpen}
        onClose={() => setHelpDialogOpen(false)}
      />
      <N8nExtractionInfoDialog
        open={infoOpen}
        variant={infoVariant}
        onClose={() => setInfoOpen(false)}
      />
      <SkillPickerModal
        open={skillPickerOpen}
        selectedIds={values.skillRefs}
        onChange={(ids) => set("skillRefs", ids)}
        onClose={() => setSkillPickerOpen(false)}
      />
      <McpPickerModal
        open={mcpPickerOpen}
        servers={mcpServers}
        isToolAllowed={isToolAllowed}
        toggleAllowedTool={toggleAllowedTool}
        onClose={() => setMcpPickerOpen(false)}
      />
    </Dialog>
  );
}
