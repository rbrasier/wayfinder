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
import type { FieldValueSource, McpToolRef, PriorStepField, TemplateField } from "@rbrasier/domain";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldGroupLabel } from "@/components/ui/field-group-label";
import { trpc } from "@/trpc/client";
import { TemplateTagsHelpDialog } from "./template-tags-help-dialog";
import { parseFieldLines } from "./template-field-editor";
import { N8nExtractionInfoDialog } from "./n8n-extraction-info-dialog";
import { SkillPickerModal } from "./skill-picker-modal";
import { McpPickerModal } from "./mcp-picker-modal";
import { TEMPLATE_COMPLETE_SENTINEL, doneWhenForOutputType } from "./output-type";
import type {
  ScheduleModifier,
  ScheduleUnit,
  ScheduleWhen,
} from "./scheduled-node-config";
import { NodeConfigModalConversational } from "./node-config-modal-conversational";
import { NodeConfigModalAuto } from "./node-config-modal-auto";
import { NodeConfigModalScheduled } from "./node-config-modal-scheduled";
import { NodeConfigModalApproval } from "./node-config-modal-approval";
import { NodeConfigModalMcp } from "./node-config-modal-mcp";
import {
  COLOURS,
  CopyButton,
  buildCustomFields,
  isAdvancedField,
  type CustomRequestField,
} from "./node-config-modal-helpers";

export type NodeConfigType = "conversational" | "auto" | "scheduled" | "approval" | "mcp";

export type ApproverSourceMode =
  | "first_level_supervisor"
  | "second_level_supervisor"
  | "dynamic";

export interface NodeConfigValues {
  name: string;
  colour: string;
  type: NodeConfigType;
  aiInstruction: string;
  doneWhen: string;
  neverDone: boolean;
  outputType: "conversation_only" | "generate_document";
  documentTemplatePath?: string | null;
  documentTemplateFilename?: string | null;
  documentTemplateContent?: string | null;
  allowManualEdit: boolean;
  requireConfirmation: boolean;
  // Ids of library skills (app_skills) attached to this conversational step.
  skillRefs: string[];
  // MCP tools this conversational step may call mid-conversation (ADR-032).
  allowedMcpToolRefs: McpToolRef[];
  instruction: string;
  executor: "n8n" | "mock";
  workflowId: string | null;
  webhookUrl: string;
  mcpServerId: string;
  mcpToolName: string;
  requestFields: TemplateField[];
  requestFieldValues: Record<string, FieldValueSource>;
  responseFields: TemplateField[];
  // Keys of author-added request fields (removable); workflow inputs are not.
  customRequestFieldKeys: string[];
  scheduleWhen: ScheduleWhen;
  scheduleNumber: string;
  scheduleUnit: ScheduleUnit;
  scheduleModifier: ScheduleModifier;
  scheduleAnchorChoice: string;
  scheduleDescribeText: string;
  approverSource: ApproverSourceMode;
  roleHint: string;
  approvalInstructions: string;
  notifyOnComplete: boolean;
}

interface NodeConfigModalProps {
  open: boolean;
  flowId: string;
  initialValues?: Partial<NodeConfigValues>;
  onSave: (values: NodeConfigValues) => void;
  onDelete?: () => void;
  onClose: () => void;
  isSaving?: boolean;
  // Fields declared by steps earlier in the flow, offered as value sources.
  priorStepFields?: PriorStepField[];
  // Power-user feature flags (ADR-022). When off, the conversational Skills and
  // MCP-tools sections are hidden — a step never offers a capability the author's
  // organisation has not enabled.
  skillsEnabled?: boolean;
  mcpEnabled?: boolean;
  onUploadTemplate?: (file: File, currentValues: NodeConfigValues) => Promise<{ path: string; filename: string; documentTemplateContent: string | null } | { error: string; code?: string }>;
}

const DEFAULT_VALUES: NodeConfigValues = {
  name: "",
  colour: "#3a5fd9",
  type: "conversational",
  aiInstruction: "",
  doneWhen: "",
  neverDone: false,
  outputType: "conversation_only",
  documentTemplatePath: null,
  documentTemplateFilename: null,
  documentTemplateContent: null,
  allowManualEdit: true,
  requireConfirmation: false,
  skillRefs: [],
  allowedMcpToolRefs: [],
  instruction: "",
  executor: "n8n",
  workflowId: null,
  webhookUrl: "",
  mcpServerId: "",
  mcpToolName: "",
  requestFields: [],
  requestFieldValues: {},
  responseFields: [],
  customRequestFieldKeys: [],
  scheduleWhen: "specific",
  scheduleNumber: "1",
  scheduleUnit: "d",
  scheduleModifier: "after",
  scheduleAnchorChoice: "node_reached",
  scheduleDescribeText: "",
  approverSource: "first_level_supervisor",
  roleHint: "",
  approvalInstructions: "",
  notifyOnComplete: false,
};

export function NodeConfigModal({
  open,
  flowId,
  initialValues,
  onSave,
  onDelete,
  onClose,
  isSaving = false,
  priorStepFields = [],
  skillsEnabled = false,
  mcpEnabled = false,
  onUploadTemplate,
}: NodeConfigModalProps) {
  const utils = trpc.useUtils();
  const [values, setValues] = useState<NodeConfigValues>({ ...DEFAULT_VALUES, ...initialValues });
  // Raw `Label (annotations)` lines edited in the field editors (mock executor).
  const [requestLines, setRequestLines] = useState<string[]>([]);
  const [responseLines, setResponseLines] = useState<string[]>([]);
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
      setCustomFields(buildCustomFields(next));
    }
    wasOpenRef.current = open;
  }, [open, initialValues]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
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

  const usesN8n = isAuto && values.executor === "n8n";

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
    (values.neverDone || isTemplateComplete || Boolean(values.doneWhen.trim()));

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

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onUploadTemplate) return;
    setUploadError(null);
    setIsUploading(true);
    try {
      const result = await onUploadTemplate(file, values);
      if ("error" in result) {
        setUploadError(result.error);
        if (result.code === "NO_TEMPLATE_TAGS") {
          setHelpDialogOpen(true);
        }
      } else {
        set("documentTemplatePath", result.path);
        set("documentTemplateFilename", result.filename);
        set("documentTemplateContent", result.documentTemplateContent ?? null);
      }
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
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
              <p className="text-[13px] leading-[1.55] text-[#5a5650]">
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
                  className="ml-auto mr-1 rounded-md p-1 text-[#6d6a65] transition-colors hover:bg-[#efede8] hover:text-[#1a1814] disabled:opacity-50"
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
                    <p className="text-[13px] text-[#c2385a]">{previewError}</p>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <p className="text-[12px] text-[#6d6a65]">
                          System prompt sent to the AI for this step (read-only)
                        </p>
                        <CopyButton text={previewPrompt ?? ""} />
                      </div>
                      <pre className="flex-1 overflow-y-auto whitespace-pre-wrap rounded-[9px] border border-[#dedad2] bg-[#f7f6f3] p-3 font-mono text-[12px] leading-[1.6] text-[#1a1814]">
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
                    <Input
                      id="node-name"
                      required
                      value={values.name}
                      onChange={(e) => set("name", e.target.value)}
                      placeholder="e.g. Gather requirements"
                    />
                  </div>

                  <div className="space-y-1">
                    <FieldGroupLabel id="ncm-step-colour">Step colour</FieldGroupLabel>
                    <div className="flex gap-2" role="group" aria-labelledby="ncm-step-colour">
                      {COLOURS.map((colour) => (
                        <button
                          key={colour.hex}
                          type="button"
                          className={`h-6 w-6 rounded-full transition-transform ${
                            values.colour === colour.hex
                              ? "scale-110 ring-2 ring-[#1a1814] ring-offset-2"
                              : "opacity-70 hover:opacity-100"
                          }`}
                          style={{ background: colour.hex }}
                          onClick={() => set("colour", colour.hex)}
                          title={colour.label}
                        />
                      ))}
                    </div>
                  </div>

                  {isConversational && (
                    <NodeConfigModalConversational
                      values={values}
                      set={set}
                      doneWhenMode={doneWhenMode}
                      handleDoneWhenModeChange={handleDoneWhenModeChange}
                      handleOutputTypeChange={handleOutputTypeChange}
                      onUploadTemplate={onUploadTemplate}
                      fileInputRef={fileInputRef}
                      handleFileChange={handleFileChange}
                      isUploading={isUploading}
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

                  {isApproval && <NodeConfigModalApproval values={values} set={set} />}

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

                  <div className="flex items-start justify-between gap-3 border-t border-[#ece9e3] pt-3">
                    <div className="space-y-0.5">
                      <Label htmlFor="notify-on-complete">Notify chat participants when step complete</Label>
                      <p className="text-[12px] text-[#6d6a65]">
                        Emails everyone in the chat once this step finishes.
                      </p>
                    </div>
                    <button
                      id="notify-on-complete"
                      type="button"
                      role="switch"
                      aria-checked={values.notifyOnComplete}
                      onClick={() => set("notifyOnComplete", !values.notifyOnComplete)}
                      className={`relative mt-1 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                        values.notifyOnComplete ? "bg-[#1f8a4c]" : "bg-[#d7d3cc]"
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          values.notifyOnComplete ? "translate-x-4" : "translate-x-0.5"
                        }`}
                      />
                    </button>
                  </div>
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
