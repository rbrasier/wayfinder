"use client";

import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { Check, Copy, Eye, HelpCircle, Pencil, Sparkles, X } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/trpc/client";
import { TemplateTagsHelpDialog } from "./template-tags-help-dialog";
import { TemplateFieldEditor, parseFieldLines } from "./template-field-editor";
import {
  FieldValueList,
  FieldValueSelector,
  ReadOnlyFieldList,
} from "./field-value-selector";
import { ScheduleSentenceBuilder } from "./schedule-sentence-builder";
import { SkillPickerModal } from "./skill-picker-modal";
import { N8nExtractionInfoDialog } from "./n8n-extraction-info-dialog";
import type {
  ScheduleModifier,
  ScheduleUnit,
  ScheduleWhen,
} from "./scheduled-node-config";

const COLOURS = [
  { hex: "#3a5fd9", label: "Indigo" },
  { hex: "#2e9e6a", label: "Green" },
  { hex: "#c17a1a", label: "Amber" },
  { hex: "#c2385a", label: "Rose" },
  { hex: "#7c3aed", label: "Purple" },
  { hex: "#0e8a7a", label: "Teal" },
];

const EXAMPLE_TAG = "{{First name}}";

// Field keys that are low-level HTTP concerns and should be hidden from the
// primary "Add request fields" list behind a collapsed "Advanced fields" section.
// Keys are normalised (lowercase, alphanumeric only) to match TemplateField.key.
const ADVANCED_REQUEST_FIELD_KEYS = new Set(["headers", "params", "query", "webhookurl", "executionmode"]);

// Returns true for exact matches (e.g. "headers") and for nested subfields
// produced by the recursive extractor (e.g. "headers.content-type").
function isAdvancedField(key: string): boolean {
  if (ADVANCED_REQUEST_FIELD_KEYS.has(key)) return true;
  return [...ADVANCED_REQUEST_FIELD_KEYS].some((prefix) => key.startsWith(`${prefix}.`));
}

export type NodeConfigType = "conversational" | "auto" | "scheduled" | "approval" | "mcp";

export type ApproverSourceMode =
  | "first_level_supervisor"
  | "second_level_supervisor"
  | "dynamic";

// An author-added request field while it is being edited. The key is derived
// from the label on save; the id keeps React rows stable as the label changes.
interface CustomRequestField {
  id: string;
  label: string;
  value: FieldValueSource;
}

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

const SCHEDULE_SELECT_CLASS =
  "flex h-10 w-full rounded-[9px] border border-[#dedad2] bg-[#f7f6f3] px-3 py-2 text-[13px] text-[#1a1814] focus:border-[#1f8a4c] focus:bg-white focus:outline-none";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-[#6d6a65] transition-colors hover:bg-[#efede8] hover:text-[#1a1814]"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

const buildCustomFields = (values: Partial<NodeConfigValues>): CustomRequestField[] => {
  const customKeys = new Set(values.customRequestFieldKeys ?? []);
  return (values.requestFields ?? [])
    .filter((field) => customKeys.has(field.key))
    .map((field) => ({
      id: field.key,
      label: field.label,
      value: values.requestFieldValues?.[field.key] ?? { kind: "ai" },
    }));
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
  // Reset form state when the modal opens for a different node.
  useEffect(() => {
    if (open) {
      const next = { ...DEFAULT_VALUES, ...initialValues };
      setValues(next);
      setRequestLines((next.requestFields ?? []).map((field) => field.raw));
      setResponseLines((next.responseFields ?? []).map((field) => field.raw));
      setCustomFields(buildCustomFields(next));
    }
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const set = <K extends keyof NodeConfigValues>(key: K, value: NodeConfigValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const isTemplateComplete = values.doneWhen === "__TEMPLATE_COMPLETE__";
  const doneWhenMode = values.neverDone ? "never" : isTemplateComplete ? "template" : "condition";

  const handleDoneWhenModeChange = (mode: string) => {
    if (mode === "never") {
      setValues((prev) => ({ ...prev, neverDone: true, doneWhen: "" }));
    } else if (mode === "template") {
      setValues((prev) => ({ ...prev, neverDone: false, doneWhen: "__TEMPLATE_COMPLETE__" }));
    } else {
      setValues((prev) => ({
        ...prev,
        neverDone: false,
        doneWhen: prev.doneWhen === "__TEMPLATE_COMPLETE__" ? "" : prev.doneWhen,
      }));
    }
  };

  const isAuto = values.type === "auto";
  const isScheduled = values.type === "scheduled";
  const isApproval = values.type === "approval";
  const isConversational = values.type === "conversational";
  const isMcp = values.type === "mcp";
  const requestParsed = parseFieldLines(requestLines);
  const responseParsed = parseFieldLines(responseLines);

  const usesN8n = isAuto && values.executor === "n8n";
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
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
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
              <>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="ai-instruction">Instructions for the AI</Label>
                  {skillsEnabled && (
                    <button
                      type="button"
                      onClick={() => setSkillPickerOpen(true)}
                      className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-[#6d6a65] transition-colors hover:bg-[#efede8] hover:text-[#1a1814]"
                      aria-label="Add skills"
                    >
                      <Sparkles size={13} />
                      {values.skillRefs.length > 0 ? `Skills · ${values.skillRefs.length}` : "Add skills"}
                    </button>
                  )}
                </div>
                {skillsEnabled && values.skillRefs.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {values.skillRefs.map((id) => {
                      const skill = skillsById.get(id);
                      return (
                        <span
                          key={id}
                          className="inline-flex items-center gap-1 rounded-full border border-[#c5d0f7] bg-[#eef1fc] px-2 py-0.5 text-[11px] text-[#3a5fd9]"
                        >
                          <Sparkles size={10} />
                          {skill?.name ?? "Skill"}
                          <button
                            type="button"
                            aria-label={`Remove ${skill?.name ?? "skill"}`}
                            className="text-[#3a5fd9] hover:text-[#25439c]"
                            onClick={() => removeSkill(id)}
                          >
                            <X size={11} />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
                <Textarea
                  id="ai-instruction"
                  required
                  rows={4}
                  value={values.aiInstruction}
                  onChange={(e) => set("aiInstruction", e.target.value)}
                  placeholder="Describe what the AI should do in this step…"
                />
              </div>

              {mcpEnabled && (
              <div className="space-y-1">
                <FieldGroupLabel id="ncm-mcp-tools">MCP tools</FieldGroupLabel>
                <p className="text-[12px] text-[#857f76]">
                  Let the AI call these tools mid-conversation. Register servers on
                  the MCP Servers page.
                </p>
                {mcpServers.length === 0 ? (
                  <p className="text-[13px] text-[#857f76]">No MCP servers available.</p>
                ) : (
                  <div className="space-y-2 rounded-[9px] border border-[#dedad2] p-2.5">
                    {mcpServers.map((entry) => (
                      <div key={entry.server.id} className="space-y-1">
                        <p className="text-[12px] font-medium text-[#5a5650]">{entry.server.label}</p>
                        {entry.tools.length === 0 ? (
                          <p className="text-[12px] text-[#857f76]">No tools discovered.</p>
                        ) : (
                          entry.tools.map((tool) => (
                            <label
                              key={tool.name}
                              className="flex cursor-pointer items-start gap-2 text-[13px]"
                            >
                              <input
                                type="checkbox"
                                className="mt-0.5"
                                checked={isToolAllowed(entry.server.id, tool.name)}
                                onChange={() => toggleAllowedTool(entry.server.id, tool.name)}
                              />
                              <span>
                                <span className="font-medium">{tool.name}</span>
                                {tool.description ? (
                                  <span className="text-[#857f76]"> — {tool.description}</span>
                                ) : null}
                              </span>
                            </label>
                          ))
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              )}

              <div className="space-y-1">
                <FieldGroupLabel id="ncm-output-type">Output type</FieldGroupLabel>
                <div className="flex gap-3" role="radiogroup" aria-labelledby="ncm-output-type">
                  {(["conversation_only", "generate_document"] as const).map((type) => (
                    <label
                      key={type}
                      className={`flex flex-1 cursor-pointer items-center justify-center rounded-[9px] border px-3 py-2 text-[13px] transition-colors ${
                        values.outputType === type
                          ? "border-[#3a5fd9] bg-[#eef1fc] font-medium text-[#3a5fd9]"
                          : "border-[#dedad2] text-[#5a5650] hover:bg-[#efede8]"
                      }`}
                    >
                      <input
                        type="radio"
                        className="sr-only"
                        value={type}
                        checked={values.outputType === type}
                        onChange={() => set("outputType", type)}
                      />
                      {type === "conversation_only" ? "Conversation only" : "Generate document"}
                    </label>
                  ))}
                </div>
              </div>

              {values.outputType === "generate_document" && (
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <FieldGroupLabel>DOCX template</FieldGroupLabel>
                    <button
                      type="button"
                      aria-label="How template tags work"
                      className="flex h-4 w-4 items-center justify-center rounded-full text-[#6d6a65] transition-colors hover:bg-[#efede8] hover:text-[#1a1814]"
                      onClick={() => setHelpDialogOpen(true)}
                    >
                      <HelpCircle size={13} />
                    </button>
                  </div>
                  <p className="text-[12px] text-[#6d6a65]">
                    Works best using variables marked with tags (e.g{" "}
                    <code className="font-mono">{EXAMPLE_TAG}</code>)
                  </p>
                  {!onUploadTemplate ? (
                    <p className="rounded-[9px] border border-dashed border-[#dedad2] bg-[#f7f6f3] p-3 text-[12px] text-[#6d6a65]">
                      Save this step first, then re-open to upload a template.
                    </p>
                  ) : values.documentTemplateFilename ? (
                    <div className="flex items-center gap-2 rounded-[9px] border border-[#c0e8d5] bg-[#eaf6f0] px-3 py-2">
                      <span className="flex-1 truncate text-[12px] text-[#247c53]">
                        {values.documentTemplateFilename}
                      </span>
                      <button
                        type="button"
                        className="shrink-0 text-[12px] text-[#6d6a65] hover:text-[#5a5650]"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isUploading}
                      >
                        Replace
                      </button>
                      <button
                        type="button"
                        className="shrink-0 text-[12px] text-[#c2385a] hover:text-[#a02e4b]"
                        onClick={() => {
                          set("documentTemplatePath", null);
                          set("documentTemplateFilename", null);
                          set("documentTemplateContent", null);
                          setUploadError(null);
                        }}
                        disabled={isUploading}
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="w-full rounded-[9px] border border-dashed border-[#dedad2] bg-[#f7f6f3] p-4 text-center text-[13px] text-[#6d6a65] transition-colors hover:border-[#c5d0f7] hover:bg-[#eef1fc] hover:text-[#3a5fd9] disabled:opacity-50"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploading}
                    >
                      {isUploading ? "Uploading…" : "Click to upload a .docx template"}
                    </button>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".docx"
                    className="sr-only"
                    onChange={handleFileChange}
                  />
                  {uploadError && (
                    <p className="text-[12px] text-[#c2385a]">{uploadError}</p>
                  )}
                </div>
              )}

              {values.outputType === "generate_document" && (
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-0.5">
                    <Label htmlFor="allow-manual-edit">Allow manual field editing</Label>
                    <p className="text-[12px] text-[#6d6a65]">
                      Operators can correct the generated document&apos;s field values before approval.
                    </p>
                  </div>
                  <button
                    id="allow-manual-edit"
                    type="button"
                    role="switch"
                    aria-checked={values.allowManualEdit}
                    onClick={() => set("allowManualEdit", !values.allowManualEdit)}
                    className={`relative mt-1 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                      values.allowManualEdit ? "bg-[#1f8a4c]" : "bg-[#d7d3cc]"
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        values.allowManualEdit ? "translate-x-4" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                </div>
              )}

              <div className="space-y-1">
                <Label htmlFor="done-when-mode">Done when…</Label>
                <select
                  id="done-when-mode"
                  className="flex h-10 w-full rounded-[9px] border border-[#dedad2] bg-[#f7f6f3] px-3 py-2 text-[13px] text-[#1a1814] focus:border-[#3a5fd9] focus:bg-white focus:outline-none"
                  value={doneWhenMode}
                  onChange={(e) => handleDoneWhenModeChange(e.target.value)}
                >
                  <option value="condition">Specific condition</option>
                  {values.outputType === "generate_document" && (
                    <option value="template">Template complete — when all template fields are gathered</option>
                  )}
                  <option value="never">Never done — user can continue to interact indefinitely</option>
                </select>
                {doneWhenMode === "condition" && (
                  <Textarea
                    id="done-when"
                    required
                    rows={2}
                    value={values.doneWhen}
                    onChange={(e) => set("doneWhen", e.target.value)}
                    placeholder="Describe the condition that marks this step complete…"
                  />
                )}
                {doneWhenMode === "template" && (
                  <p className="rounded-[9px] border border-[#c5d0f7] bg-[#eef1fc] px-3 py-2 text-[12px] text-[#3a5fd9]">
                    This step is complete when all required fields in the document template have been gathered from the user.
                  </p>
                )}
              </div>

              {doneWhenMode !== "never" && (
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-0.5">
                    <Label htmlFor="require-confirmation">Require confirmation before completing this step</Label>
                    <p className="text-[12px] text-[#6d6a65]">
                      When this step is complete, hold it open until the operator clicks Proceed instead of advancing automatically.
                    </p>
                  </div>
                  <button
                    id="require-confirmation"
                    type="button"
                    role="switch"
                    aria-checked={values.requireConfirmation}
                    onClick={() => set("requireConfirmation", !values.requireConfirmation)}
                    className={`relative mt-1 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                      values.requireConfirmation ? "bg-[#1f8a4c]" : "bg-[#d7d3cc]"
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        values.requireConfirmation ? "translate-x-4" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                </div>
              )}
              </>
              )}

              {isAuto && (
              <>
              <div className="space-y-1">
                <Label htmlFor="auto-instruction">Instruction for n8n</Label>
                <Textarea
                  id="auto-instruction"
                  required
                  rows={4}
                  value={values.instruction}
                  onChange={(e) => set("instruction", e.target.value)}
                  placeholder="Describe the task the n8n sub-workflow should perform…"
                />
              </div>

              <div className="space-y-1">
                <FieldGroupLabel id="ncm-executor">Executor</FieldGroupLabel>
                <div className="flex gap-3" role="radiogroup" aria-labelledby="ncm-executor">
                  {(["n8n", "mock"] as const).map((executor) => (
                    <label
                      key={executor}
                      className={`flex flex-1 cursor-pointer items-center justify-center rounded-[9px] border px-3 py-2 text-[13px] transition-colors ${
                        values.executor === executor
                          ? "border-[#7c3aed] bg-[#f3eefc] font-medium text-[#7c3aed]"
                          : "border-[#dedad2] text-[#5a5650] hover:bg-[#efede8]"
                      }`}
                    >
                      <input
                        type="radio"
                        className="sr-only"
                        value={executor}
                        checked={values.executor === executor}
                        onChange={() => set("executor", executor)}
                      />
                      {executor === "n8n" ? "n8n webhook" : "Mock (testing)"}
                    </label>
                  ))}
                </div>
              </div>

              {values.executor === "n8n" && (
                <div className="space-y-1">
                  <Label htmlFor="auto-workflow">n8n workflow</Label>
                  {workflowsQuery.isLoading ? (
                    <p className="text-[12px] text-[#6d6a65]">Loading workflows…</p>
                  ) : workflowsQuery.error ? (
                    <p className="text-[12px] text-[#c2385a]">
                      Could not load workflows. Configure an n8n instance in Admin → Settings.
                    </p>
                  ) : (
                    <select
                      id="auto-workflow"
                      className="flex h-10 w-full rounded-[9px] border border-[#dedad2] bg-[#f7f6f3] px-3 py-2 text-[13px] text-[#1a1814] focus:border-[#3a5fd9] focus:bg-white focus:outline-none"
                      value={values.workflowId ?? ""}
                      onChange={(e) => selectWorkflow(e.target.value)}
                    >
                      <option value="">Select a workflow…</option>
                      {workflows.map((workflow) => (
                        <option key={workflow.id} value={workflow.id}>
                          {workflow.name}
                          {workflow.webhookUrl ? "" : " (no webhook trigger)"}
                        </option>
                      ))}
                    </select>
                  )}
                  {selectedWorkflow && !selectedWorkflow.webhookUrl && (
                    <p className="text-[12px] text-[#c2385a]">
                      This workflow has no webhook trigger and cannot be called automatically.
                    </p>
                  )}
                </div>
              )}

              {usesN8n && values.workflowId && (
                <>
                  <div className="space-y-2" role="group" aria-labelledby="ncm-request-fields">
                    <FieldGroupLabel id="ncm-request-fields">Add request fields</FieldGroupLabel>
                    <p className="text-[12px] text-[#6d6a65]">
                      Choose where each value comes from: the AI, an earlier step, a typed value, or none.
                    </p>
                    {schemaQuery.isLoading ? (
                      <p className="text-[12px] text-[#6d6a65]">Reading the workflow schema…</p>
                    ) : (
                      <>
                        <FieldValueList
                          fields={regularDerivedInputs}
                          values={values.requestFieldValues}
                          onChange={setFieldValue}
                          priorStepFields={priorStepFields}
                        />
                        {derivedInputs.length === 0 && (
                          <p className="rounded-[9px] border border-dashed border-[#dedad2] bg-[#f7f6f3] p-3 text-[12px] text-[#6d6a65]">
                            No inputs found for this workflow
                            {schema && !schema.hasExecutions ? " (it hasn't run yet)" : ""}.{" "}
                            <button
                              type="button"
                              className="font-medium text-[#3a5fd9] underline"
                              onClick={() => openInfo("inputs")}
                            >
                              More info
                            </button>
                          </p>
                        )}
                        {customFields.map((field) => (
                          <div
                            key={field.id}
                            className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] items-start gap-2"
                          >
                            <Input
                              aria-label="Custom field name"
                              value={field.label}
                              onChange={(e) => updateCustomLabel(field.id, e.target.value)}
                              placeholder="Field name"
                            />
                            <FieldValueSelector
                              value={field.value}
                              onChange={(next) => updateCustomValue(field.id, next)}
                              priorStepFields={priorStepFields}
                            />
                            <button
                              type="button"
                              aria-label="Remove field"
                              className="mt-1 flex h-7 w-7 items-center justify-center rounded-md text-[#c2385a] transition-colors hover:bg-[#fdf3f5]"
                              onClick={() => removeCustomField(field.id)}
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          className="text-[13px] font-medium text-[#3a5fd9] hover:underline"
                          onClick={addCustomField}
                        >
                          + Add field
                        </button>
                        {advancedDerivedInputs.length > 0 && (
                          <details className="group mt-1">
                            <summary className="cursor-pointer list-none text-[13px] font-medium text-[#6d6a65] hover:text-[#605c57] [&::-webkit-details-marker]:hidden">
                              <span className="group-open:hidden">▶ Advanced fields</span>
                              <span className="hidden group-open:inline">▼ Advanced fields</span>
                            </summary>
                            <div className="mt-2 space-y-2 rounded-[9px] border border-[#dedad2] bg-[#f7f6f3] p-3">
                              <FieldValueList
                                fields={advancedDerivedInputs}
                                values={values.requestFieldValues}
                                onChange={setFieldValue}
                                priorStepFields={priorStepFields}
                              />
                            </div>
                          </details>
                        )}
                      </>
                    )}
                  </div>

                  <div className="space-y-1" role="group" aria-labelledby="ncm-expected-outputs">
                    <FieldGroupLabel id="ncm-expected-outputs">Expected outputs (from n8n)</FieldGroupLabel>
                    <p className="text-[12px] text-[#6d6a65]">
                      Returned by the workflow and stored as this step&apos;s output.
                    </p>
                    {schemaQuery.isLoading ? (
                      <p className="text-[12px] text-[#6d6a65]">Reading the workflow schema…</p>
                    ) : derivedOutputs.length > 0 ? (
                      <ReadOnlyFieldList fields={derivedOutputs} emptyText="" />
                    ) : (
                      <p className="rounded-[9px] border border-dashed border-[#dedad2] bg-[#f7f6f3] p-3 text-[12px] text-[#6d6a65]">
                        No outputs found for this workflow
                        {schema && !schema.hasExecutions ? " (it hasn't run yet)" : ""}.{" "}
                        <button
                          type="button"
                          className="font-medium text-[#3a5fd9] underline"
                          onClick={() => openInfo("outputs")}
                        >
                          More info
                        </button>
                      </p>
                    )}
                  </div>
                </>
              )}

              {!usesN8n && (
                <>
                  <TemplateFieldEditor
                    label="Request fields"
                    helpText="Fields sent with the request. Use the same Label (type) syntax as document templates."
                    lines={requestLines}
                    onChange={setRequestLines}
                  />
                  {mockRequestFields.length > 0 && (
                    <div className="space-y-2" role="group" aria-labelledby="ncm-field-values">
                      <FieldGroupLabel id="ncm-field-values">Field values</FieldGroupLabel>
                      <FieldValueList
                        fields={mockRequestFields}
                        values={values.requestFieldValues}
                        onChange={setFieldValue}
                        priorStepFields={priorStepFields}
                      />
                    </div>
                  )}
                  <TemplateFieldEditor
                    label="Response fields (expected back)"
                    helpText="The structured values the step is expected to return. Matched values are stored; anything else is left blank."
                    lines={responseLines}
                    onChange={setResponseLines}
                  />
                </>
              )}
              </>
              )}

              {isScheduled && (
              <>
              <div className="space-y-1">
                <Label htmlFor="schedule-when">When should this run?</Label>
                <select
                  id="schedule-when"
                  className={SCHEDULE_SELECT_CLASS}
                  value={values.scheduleWhen}
                  onChange={(e) => set("scheduleWhen", e.target.value as ScheduleWhen)}
                >
                  <option value="ai">AI Decides (or asks the user)</option>
                  <option value="specific">Pick a date and time</option>
                  <option value="describe">Type anything</option>
                </select>
              </div>

              {values.scheduleWhen === "ai" && (
                <p className="text-[12px] text-[#6d6a65]">
                  The AI chooses the fire time from the session context, or asks the user.
                </p>
              )}

              {values.scheduleWhen === "specific" && (
                <div className="space-y-1" role="group" aria-labelledby="ncm-fire-step">
                  <FieldGroupLabel id="ncm-fire-step">Fire this step</FieldGroupLabel>
                  <ScheduleSentenceBuilder
                    number={values.scheduleNumber}
                    unit={values.scheduleUnit}
                    modifier={values.scheduleModifier}
                    anchorChoice={values.scheduleAnchorChoice}
                    priorStepFields={priorStepFields}
                    onNumberChange={(value) => set("scheduleNumber", value)}
                    onUnitChange={(value) => set("scheduleUnit", value)}
                    onModifierChange={(value) => set("scheduleModifier", value)}
                    onAnchorChange={(value) => set("scheduleAnchorChoice", value)}
                  />
                </div>
              )}

              {values.scheduleWhen === "describe" && (
                <div className="space-y-1">
                  <Label htmlFor="schedule-describe">Describe when to run</Label>
                  <Textarea
                    id="schedule-describe"
                    rows={3}
                    value={values.scheduleDescribeText}
                    onChange={(e) => set("scheduleDescribeText", e.target.value)}
                    placeholder="e.g. two business days after the invoice is approved"
                  />
                  <p className="text-[12px] text-[#6d6a65]">
                    The AI works out the exact date and time from the session at runtime.
                  </p>
                </div>
              )}
              </>
              )}

              {isApproval && (
              <>
              <div className="space-y-1">
                <Label htmlFor="approver-source">Who approves?</Label>
                <select
                  id="approver-source"
                  className={SCHEDULE_SELECT_CLASS}
                  value={values.approverSource}
                  onChange={(e) => set("approverSource", e.target.value as ApproverSourceMode)}
                >
                  <option value="first_level_supervisor">First-level supervisor</option>
                  <option value="second_level_supervisor">Second-level supervisor</option>
                  <option value="dynamic">Dynamic — resolved from policy/context</option>
                </select>
                <p className="text-[12px] text-[#6d6a65]">
                  The operator always confirms the suggested approver, and can choose someone else.
                </p>
              </div>

              {values.approverSource === "dynamic" && (
                <div className="space-y-1">
                  <Label htmlFor="approver-role-hint">Role hint (optional)</Label>
                  <Input
                    id="approver-role-hint"
                    value={values.roleHint}
                    onChange={(e) => set("roleHint", e.target.value)}
                    placeholder="e.g. SES Band 1 delegate"
                  />
                </div>
              )}

              <div className="space-y-1">
                <Label htmlFor="approval-instructions">Instructions (optional)</Label>
                <Textarea
                  id="approval-instructions"
                  rows={3}
                  value={values.approvalInstructions}
                  onChange={(e) => set("approvalInstructions", e.target.value)}
                  placeholder="Shown to the operator and the approver…"
                />
              </div>
              </>
              )}

              {isMcp && (
              <>
              <div className="space-y-1">
                <Label htmlFor="mcp-server">MCP server</Label>
                <select
                  id="mcp-server"
                  className={SCHEDULE_SELECT_CLASS}
                  value={values.mcpServerId}
                  onChange={(e) => {
                    set("mcpServerId", e.target.value);
                    set("mcpToolName", "");
                  }}
                >
                  <option value="">Select a server…</option>
                  {mcpServers.map((entry) => (
                    <option key={entry.server.id} value={entry.server.id}>
                      {entry.server.label}
                    </option>
                  ))}
                </select>
                {!mcpServersQuery.isLoading && mcpServers.length === 0 && (
                  <p className="text-[12px] text-[#918d87]">
                    No active MCP servers. Register one on the MCP Servers page.
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <Label htmlFor="mcp-tool">Tool</Label>
                {selectedMcpServer && selectedMcpServer.tools.length === 0 ? (
                  <Input
                    id="mcp-tool"
                    value={values.mcpToolName}
                    onChange={(e) => set("mcpToolName", e.target.value)}
                    placeholder="Type the tool name (server exposed none / unreachable)"
                  />
                ) : (
                  <select
                    id="mcp-tool"
                    className={SCHEDULE_SELECT_CLASS}
                    value={values.mcpToolName}
                    disabled={!selectedMcpServer}
                    onChange={(e) => set("mcpToolName", e.target.value)}
                  >
                    <option value="">Select a tool…</option>
                    {selectedMcpServer?.tools.map((tool) => (
                      <option key={tool.name} value={tool.name}>
                        {tool.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="space-y-1">
                <Label htmlFor="mcp-instruction">Instructions for resolving inputs</Label>
                <Textarea
                  id="mcp-instruction"
                  rows={3}
                  value={values.instruction}
                  onChange={(e) => set("instruction", e.target.value)}
                  placeholder="Describe how to fill the tool's request fields from the conversation…"
                />
              </div>

              <TemplateFieldEditor
                label="Request fields (tool arguments)"
                helpText="Fields sent as the tool's arguments. Use the same Label (type) syntax as document templates."
                lines={requestLines}
                onChange={setRequestLines}
              />
              {requestParsed.fields.length > 0 && (
                <div className="space-y-2">
                  <FieldGroupLabel id="ncm-mcp-field-values">Field values</FieldGroupLabel>
                  <FieldValueList
                    fields={requestParsed.fields}
                    values={values.requestFieldValues}
                    onChange={setFieldValue}
                    priorStepFields={priorStepFields}
                  />
                </div>
              )}
              <TemplateFieldEditor
                label="Response fields (use a field with key “output” to capture the result)"
                helpText="The tool result is provided under the key output. Add a response field named Output to store it."
                lines={responseLines}
                onChange={setResponseLines}
              />
              </>
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
    </Dialog>
  );
}
