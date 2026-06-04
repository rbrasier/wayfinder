"use client";

import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { Check, Copy, Eye, HelpCircle, Pencil } from "lucide-react";
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
import { describeRecurrenceRule } from "@rbrasier/domain";
import type {
  FieldValueSource,
  PriorStepField,
  RecurrenceFrequency,
  TemplateField,
} from "@rbrasier/domain";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CalendarPicker, type YearMonth } from "@/components/ui/calendar-picker";
import { TimeWheel } from "@/components/ui/time-wheel";
import { trpc } from "@/trpc/client";
import { TemplateTagsHelpDialog } from "./template-tags-help-dialog";
import { TemplateFieldEditor, parseFieldLines } from "./template-field-editor";
import { FieldValueList, FieldValueSelector, ReadOnlyFieldList } from "./field-value-selector";
import { STEP_TYPE_ACCENT } from "./node-styles";
import {
  browserTimezone,
  buildRecurrenceRule,
  isoToLocalParts,
  localPartsToIso,
} from "./scheduled-config";

const COLOURS = [
  { hex: "#3a5fd9", label: "Indigo" },
  { hex: "#2e9e6a", label: "Green" },
  { hex: "#c17a1a", label: "Amber" },
  { hex: "#c2385a", label: "Rose" },
  { hex: "#7c3aed", label: "Purple" },
  { hex: "#0e8a7a", label: "Teal" },
];

const EXAMPLE_TAG = "{{First name}}";

export type NodeConfigType = "conversational" | "auto" | "scheduled";

// Authoring offers plain-language kinds only; legacy `cron` rows are mapped to
// `recurrence` when a node is opened.
export type ScheduleKind = "relative" | "at" | "recurrence";
export type ScheduleAnchor = "node_reached" | "step_metadata";

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
  instruction: string;
  executor: "n8n" | "mock";
  workflowId: string | null;
  webhookUrl: string;
  requestFields: TemplateField[];
  requestFieldValues: Record<string, FieldValueSource>;
  responseFields: TemplateField[];
  scheduleKind: ScheduleKind;
  scheduleSpec: string;
  scheduleSpecSource: FieldValueSource;
  scheduleRecurring: boolean;
  scheduleMaxOccurrences: string;
  scheduleAnchor: ScheduleAnchor;
  scheduleMetadataKey: string;
  // Structured recurrence (kind === "recurrence").
  recurrenceFrequency: RecurrenceFrequency;
  recurrenceInterval: string;
  recurrenceWeekdays: number[];
  recurrenceMonthDay: string;
  recurrenceHour: number;
  recurrenceMinute: number;
  recurrenceTimezone: string;
}

interface NodeConfigModalProps {
  open: boolean;
  flowId: string;
  initialValues?: Partial<NodeConfigValues>;
  onSave: (values: NodeConfigValues) => void;
  onDelete?: () => void;
  onClose: () => void;
  isSaving?: boolean;
  autoNodeEnabled?: boolean;
  scheduledNodeEnabled?: boolean;
  // Fields declared by steps earlier in the flow, offered as value sources.
  priorStepFields?: PriorStepField[];
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
  instruction: "",
  executor: "n8n",
  workflowId: null,
  webhookUrl: "",
  requestFields: [],
  requestFieldValues: {},
  responseFields: [],
  scheduleKind: "relative",
  scheduleSpec: "",
  scheduleSpecSource: { kind: "ai" },
  scheduleRecurring: false,
  scheduleMaxOccurrences: "",
  scheduleAnchor: "node_reached",
  scheduleMetadataKey: "",
  recurrenceFrequency: "weekly",
  recurrenceInterval: "1",
  recurrenceWeekdays: [1],
  recurrenceMonthDay: "1",
  recurrenceHour: 9,
  recurrenceMinute: 0,
  recurrenceTimezone: "",
};

const WEEKDAY_TOGGLES = [
  { value: 0, label: "S" },
  { value: 1, label: "M" },
  { value: 2, label: "T" },
  { value: 3, label: "W" },
  { value: 4, label: "T" },
  { value: 5, label: "F" },
  { value: 6, label: "S" },
];

const SCHEDULED_ACCENT = STEP_TYPE_ACCENT.scheduled;

const SCHEDULE_SELECT_CLASS =
  "flex h-10 w-full rounded-[9px] border border-[#dedad2] bg-[#f7f6f3] px-3 py-2 text-[13px] text-[#1a1814] focus:border-[#1f8a4c] focus:bg-white focus:outline-none";

const formatLocalDateTime = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

// Calendar + iOS-style time wheels editing a single absolute instant, stored as
// an ISO string. The author picks in their local timezone.
function DateTimePicker({ value, onChange }: { value: string; onChange: (iso: string) => void }) {
  const now = new Date();
  const parts =
    isoToLocalParts(value) ?? {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      day: now.getDate(),
      hour: 9,
      minute: 0,
    };
  const [view, setView] = useState<YearMonth>({ year: parts.year, month: parts.month });

  // A freshly chosen "specific" source starts blank; seed it so the picker
  // reflects a concrete instant and the step validates.
  useEffect(() => {
    if (!value) onChange(localPartsToIso(parts));
  }, [value, parts, onChange]);

  const emit = (next: Partial<typeof parts>) => onChange(localPartsToIso({ ...parts, ...next }));

  return (
    <div className="space-y-2">
      <CalendarPicker
        year={view.year}
        month={view.month}
        day={parts.day}
        onSelect={(picked) => emit({ year: picked.year, month: picked.month, day: picked.day })}
        onMonthChange={setView}
      />
      <TimeWheel
        hour={parts.hour}
        minute={parts.minute}
        onChange={(time) => emit({ hour: time.hour, minute: time.minute })}
      />
      {value && (
        <p className="text-center text-[12px] font-medium text-[#5a5650]">{formatLocalDateTime(value)}</p>
      )}
    </div>
  );
}

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
      className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-[#918d87] transition-colors hover:bg-[#efede8] hover:text-[#1a1814]"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

export function NodeConfigModal({
  open,
  flowId,
  initialValues,
  onSave,
  onDelete,
  onClose,
  isSaving = false,
  autoNodeEnabled = false,
  scheduledNodeEnabled = false,
  priorStepFields = [],
  onUploadTemplate,
}: NodeConfigModalProps) {
  const utils = trpc.useUtils();
  const [values, setValues] = useState<NodeConfigValues>({ ...DEFAULT_VALUES, ...initialValues });
  // Raw `Label (annotations)` lines edited in the field editors; the source of
  // truth while editing so malformed lines stay visible with their errors.
  const [requestLines, setRequestLines] = useState<string[]>([]);
  const [responseLines, setResponseLines] = useState<string[]>([]);
  // Reset form state when the modal opens for a different node.
  useEffect(() => {
    if (open) {
      const next = { ...DEFAULT_VALUES, ...initialValues };
      setValues(next);
      setRequestLines((next.requestFields ?? []).map((field) => field.raw));
      setResponseLines((next.responseFields ?? []).map((field) => field.raw));
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
  const isConversational = values.type === "conversational";
  const requestParsed = parseFieldLines(requestLines);
  const responseParsed = parseFieldLines(responseLines);

  const usesN8n = isAuto && values.executor === "n8n";
  const workflowsQuery = trpc.n8n.listWorkflows.useQuery(undefined, { enabled: open && usesN8n });
  const workflows = workflowsQuery.data ?? [];
  const selectedWorkflow = workflows.find((workflow) => workflow.id === values.workflowId) ?? null;

  // Workflow inputs are read-only and combine with author-added extras to form
  // the full request-field set. Mock executor uses only the author-added fields.
  const derivedInputs = usesN8n && selectedWorkflow ? selectedWorkflow.inputs : [];
  const derivedOutputs = usesN8n && selectedWorkflow ? selectedWorkflow.outputs : [];
  const requestFields = [...derivedInputs, ...requestParsed.fields];

  const setFieldValue = (key: string, next: FieldValueSource) =>
    setValues((prev) => ({
      ...prev,
      requestFieldValues: { ...prev.requestFieldValues, [key]: next },
    }));

  const selectWorkflow = (workflowId: string) => {
    const workflow = workflows.find((candidate) => candidate.id === workflowId);
    setValues((prev) => ({
      ...prev,
      workflowId: workflowId || null,
      webhookUrl: workflow?.webhookUrl ?? "",
    }));
  };

  const conversationalValid =
    Boolean(values.name.trim()) &&
    Boolean(values.aiInstruction.trim()) &&
    (values.neverDone || isTemplateComplete || Boolean(values.doneWhen.trim()));

  const autoValid =
    Boolean(values.name.trim()) &&
    Boolean(values.instruction.trim()) &&
    (values.executor !== "n8n" || (Boolean(values.workflowId) && Boolean(values.webhookUrl.trim()))) &&
    requestParsed.valid &&
    (usesN8n || responseParsed.valid);

  // For an `at` schedule the time lives in the value source; a literal one still
  // needs a value. Relative requires its duration; recurrence always has a
  // valid default (interval 1, time 9am).
  const scheduleSpecSatisfied =
    values.scheduleKind === "at"
      ? values.scheduleSpecSource.kind !== "literal" ||
        Boolean(values.scheduleSpecSource.value.trim())
      : values.scheduleKind === "recurrence"
        ? true
        : Boolean(values.scheduleSpec.trim());

  const scheduledValid =
    Boolean(values.name.trim()) &&
    scheduleSpecSatisfied &&
    (values.scheduleKind !== "relative" ||
      values.scheduleAnchor !== "step_metadata" ||
      Boolean(values.scheduleMetadataKey.trim()));

  const canSave = isAuto ? autoValid : isScheduled ? scheduledValid : conversationalValid;

  const handleSave = () => {
    if (!canSave) return;
    if (isAuto) {
      const finalRequestFields = usesN8n
        ? [...derivedInputs, ...requestParsed.fields]
        : requestParsed.fields;
      const finalResponseFields = usesN8n ? derivedOutputs : responseParsed.fields;
      // Drop value bindings for fields that no longer exist.
      const keys = new Set(finalRequestFields.map((field) => field.key));
      const prunedValues = Object.fromEntries(
        Object.entries(values.requestFieldValues).filter(([key]) => keys.has(key)),
      );
      onSave({
        ...values,
        requestFields: finalRequestFields,
        requestFieldValues: prunedValues,
        responseFields: finalResponseFields,
      });
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
      <DialogContent className="max-w-md">
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
                  className="ml-auto mr-1 rounded-md p-1 text-[#918d87] transition-colors hover:bg-[#efede8] hover:text-[#1a1814] disabled:opacity-50"
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
                        <p className="text-[12px] text-[#918d87]">
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
                <Label>Step colour</Label>
                <div className="flex gap-2">
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

              {(autoNodeEnabled || scheduledNodeEnabled) && (
                <div className="space-y-1">
                  <Label>Step type</Label>
                  <div className="flex gap-3">
                    {(
                      [
                        "conversational",
                        ...(autoNodeEnabled ? (["auto"] as const) : []),
                        ...(scheduledNodeEnabled ? (["scheduled"] as const) : []),
                      ] as NodeConfigType[]
                    ).map((type) => {
                      const accent = STEP_TYPE_ACCENT[type];
                      const isSelected = values.type === type;
                      return (
                      <label
                        key={type}
                        className={`flex flex-1 cursor-pointer items-center justify-center rounded-[9px] border px-3 py-2 text-[13px] font-medium transition-colors ${
                          isSelected
                            ? ""
                            : "border-[#dedad2] font-normal text-[#5a5650] hover:bg-[#efede8]"
                        }`}
                        style={
                          isSelected
                            ? { borderColor: accent, backgroundColor: `${accent}14`, color: accent }
                            : undefined
                        }
                      >
                        <input
                          type="radio"
                          className="sr-only"
                          value={type}
                          checked={isSelected}
                          onChange={() => set("type", type)}
                        />
                        {type === "conversational"
                          ? "Conversational"
                          : type === "auto"
                            ? "Automated (n8n)"
                            : "Scheduled"}
                      </label>
                      );
                    })}
                  </div>
                  <p className="text-[12px] text-[#918d87]">
                    {isAuto
                      ? "Runs automatically via an n8n sub-workflow — no conversation. Completes when n8n calls back."
                      : isScheduled
                        ? "Pauses the session and resumes (once or recurring) at a computed time."
                        : "A human takes a turn with the AI to complete this step."}
                  </p>
                </div>
              )}

              {isConversational && (
              <>
              <div className="space-y-1">
                <Label htmlFor="ai-instruction">Instructions for the AI</Label>
                <Textarea
                  id="ai-instruction"
                  required
                  rows={4}
                  value={values.aiInstruction}
                  onChange={(e) => set("aiInstruction", e.target.value)}
                  placeholder="Describe what the AI should do in this step…"
                />
              </div>

              <div className="space-y-1">
                <Label>Output type</Label>
                <div className="flex gap-3">
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
                    <Label>DOCX template</Label>
                    <button
                      type="button"
                      aria-label="How template tags work"
                      className="flex h-4 w-4 items-center justify-center rounded-full text-[#918d87] transition-colors hover:bg-[#efede8] hover:text-[#1a1814]"
                      onClick={() => setHelpDialogOpen(true)}
                    >
                      <HelpCircle size={13} />
                    </button>
                  </div>
                  <p className="text-[12px] text-[#918d87]">
                    Works best using variables marked with tags (e.g{" "}
                    <code className="font-mono">{EXAMPLE_TAG}</code>)
                  </p>
                  {!onUploadTemplate ? (
                    <p className="rounded-[9px] border border-dashed border-[#dedad2] bg-[#f7f6f3] p-3 text-[12px] text-[#918d87]">
                      Save this step first, then re-open to upload a template.
                    </p>
                  ) : values.documentTemplateFilename ? (
                    <div className="flex items-center gap-2 rounded-[9px] border border-[#c0e8d5] bg-[#eaf6f0] px-3 py-2">
                      <span className="flex-1 truncate text-[12px] text-[#2e9e6a]">
                        {values.documentTemplateFilename}
                      </span>
                      <button
                        type="button"
                        className="shrink-0 text-[12px] text-[#918d87] hover:text-[#5a5650]"
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
                      className="w-full rounded-[9px] border border-dashed border-[#dedad2] bg-[#f7f6f3] p-4 text-center text-[13px] text-[#918d87] transition-colors hover:border-[#c5d0f7] hover:bg-[#eef1fc] hover:text-[#3a5fd9] disabled:opacity-50"
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
                <Label>Executor</Label>
                <div className="flex gap-3">
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
                    <p className="text-[12px] text-[#918d87]">Loading workflows…</p>
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

              {usesN8n && selectedWorkflow && (
                <div className="space-y-1">
                  <Label>Expected outputs (from n8n)</Label>
                  <p className="text-[12px] text-[#918d87]">
                    Returned by the workflow and stored as this step&apos;s output.
                  </p>
                  <ReadOnlyFieldList fields={derivedOutputs} emptyText="This workflow declares no outputs." />
                </div>
              )}

              <TemplateFieldEditor
                label={usesN8n ? "Add request fields" : "Request fields"}
                helpText={
                  usesN8n
                    ? "Extra fields to send alongside the workflow's inputs. Use the same Label (type) syntax as document templates."
                    : "Fields sent with the request. Use the same Label (type) syntax as document templates."
                }
                lines={requestLines}
                onChange={setRequestLines}
              />

              {(!usesN8n || selectedWorkflow) && requestFields.length > 0 && (
                <div className="space-y-2">
                  <Label>Field values</Label>
                  <p className="text-[12px] text-[#918d87]">
                    Choose where each value comes from: the AI, an earlier step&apos;s field, or a specific value.
                  </p>
                  <FieldValueList
                    fields={requestFields}
                    values={values.requestFieldValues}
                    onChange={setFieldValue}
                    priorStepFields={priorStepFields}
                  />
                </div>
              )}

              {!usesN8n && (
                <TemplateFieldEditor
                  label="Response fields (expected back)"
                  helpText="The structured values the step is expected to return. Matched values are stored; anything else is left blank."
                  lines={responseLines}
                  onChange={setResponseLines}
                />
              )}
              </>
              )}

              {isScheduled && (
              <>
              <div className="space-y-1">
                <Label htmlFor="schedule-kind">When should this run?</Label>
                <select
                  id="schedule-kind"
                  className={SCHEDULE_SELECT_CLASS}
                  value={values.scheduleKind}
                  onChange={(e) => set("scheduleKind", e.target.value as ScheduleKind)}
                >
                  <option value="relative">Run after a delay</option>
                  <option value="at">At a specific date &amp; time</option>
                  <option value="recurrence">Repeat on a schedule</option>
                </select>
              </div>

              {values.scheduleKind === "relative" && (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="schedule-spec">Run after</Label>
                    <Input
                      id="schedule-spec"
                      value={values.scheduleSpec}
                      onChange={(e) => set("scheduleSpec", e.target.value)}
                      placeholder="30d"
                    />
                    <p className="text-[12px] text-[#918d87]">
                      A duration, e.g. 30d (days), 2h (hours), 15m (minutes), 1w (weeks).
                    </p>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="schedule-anchor">Counting from</Label>
                    <select
                      id="schedule-anchor"
                      className={SCHEDULE_SELECT_CLASS}
                      value={values.scheduleAnchor}
                      onChange={(e) => set("scheduleAnchor", e.target.value as ScheduleAnchor)}
                    >
                      <option value="node_reached">When this step is reached</option>
                      <option value="step_metadata">A date carried from an earlier step</option>
                    </select>
                  </div>
                  {values.scheduleAnchor === "step_metadata" && (
                    <div className="space-y-1">
                      <Label htmlFor="schedule-metadata-key">Which earlier-step date?</Label>
                      <Input
                        id="schedule-metadata-key"
                        value={values.scheduleMetadataKey}
                        onChange={(e) => set("scheduleMetadataKey", e.target.value)}
                        placeholder="approvedAt"
                      />
                      <p className="text-[12px] text-[#918d87]">
                        The name of the date field captured earlier in the flow.
                      </p>
                    </div>
                  )}
                </>
              )}

              {values.scheduleKind === "at" && (
                <div className="space-y-1">
                  <Label>Fire date &amp; time</Label>
                  <p className="text-[12px] text-[#918d87]">
                    Let the AI decide, take it from an earlier step, or pick a specific date &amp; time
                    (in your timezone).
                  </p>
                  <FieldValueSelector
                    value={values.scheduleSpecSource}
                    onChange={(next) => set("scheduleSpecSource", next)}
                    priorStepFields={priorStepFields}
                    literalLabel="A specific date & time"
                    renderLiteral={(literal, onChange) => (
                      <DateTimePicker value={literal} onChange={onChange} />
                    )}
                  />
                </div>
              )}

              {values.scheduleKind === "recurrence" && (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="recurrence-frequency">Repeats</Label>
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] text-[#5a5650]">Every</span>
                      <Input
                        id="recurrence-interval"
                        type="number"
                        min="1"
                        className="w-16"
                        value={values.recurrenceInterval}
                        onChange={(e) => set("recurrenceInterval", e.target.value)}
                      />
                      <select
                        id="recurrence-frequency"
                        className={SCHEDULE_SELECT_CLASS}
                        value={values.recurrenceFrequency}
                        onChange={(e) =>
                          set("recurrenceFrequency", e.target.value as RecurrenceFrequency)
                        }
                      >
                        <option value="daily">
                          {Number(values.recurrenceInterval) === 1 ? "day" : "days"}
                        </option>
                        <option value="weekly">
                          {Number(values.recurrenceInterval) === 1 ? "week" : "weeks"}
                        </option>
                        <option value="monthly">
                          {Number(values.recurrenceInterval) === 1 ? "month" : "months"}
                        </option>
                      </select>
                    </div>
                  </div>

                  {values.recurrenceFrequency === "weekly" && (
                    <div className="space-y-1">
                      <Label>On these days</Label>
                      <div className="flex gap-1.5">
                        {WEEKDAY_TOGGLES.map((weekday) => {
                          const active = values.recurrenceWeekdays.includes(weekday.value);
                          return (
                            <button
                              key={weekday.value}
                              type="button"
                              aria-pressed={active}
                              onClick={() =>
                                set(
                                  "recurrenceWeekdays",
                                  active
                                    ? values.recurrenceWeekdays.filter((day) => day !== weekday.value)
                                    : [...values.recurrenceWeekdays, weekday.value].sort(),
                                )
                              }
                              className="h-9 w-9 rounded-full border text-[13px] font-medium transition-colors"
                              style={
                                active
                                  ? {
                                      borderColor: SCHEDULED_ACCENT,
                                      backgroundColor: `${SCHEDULED_ACCENT}14`,
                                      color: SCHEDULED_ACCENT,
                                    }
                                  : { borderColor: "#dedad2", color: "#5a5650" }
                              }
                            >
                              {weekday.label}
                            </button>
                          );
                        })}
                      </div>
                      <p className="text-[12px] text-[#918d87]">
                        Leave all unselected to repeat on the day the step is first reached.
                      </p>
                    </div>
                  )}

                  {values.recurrenceFrequency === "monthly" && (
                    <div className="space-y-1">
                      <Label htmlFor="recurrence-month-day">On day of the month</Label>
                      <Input
                        id="recurrence-month-day"
                        type="number"
                        min="1"
                        max="31"
                        className="w-20"
                        value={values.recurrenceMonthDay}
                        onChange={(e) => set("recurrenceMonthDay", e.target.value)}
                      />
                    </div>
                  )}

                  <div className="space-y-1">
                    <Label>At</Label>
                    <TimeWheel
                      hour={values.recurrenceHour}
                      minute={values.recurrenceMinute}
                      onChange={(time) => {
                        set("recurrenceHour", time.hour);
                        set("recurrenceMinute", time.minute);
                      }}
                    />
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="schedule-max">Stop after (blank = repeat forever)</Label>
                    <Input
                      id="schedule-max"
                      type="number"
                      min="1"
                      value={values.scheduleMaxOccurrences}
                      onChange={(e) => set("scheduleMaxOccurrences", e.target.value)}
                      placeholder="e.g. 4 occurrences"
                    />
                  </div>

                  <p
                    className="rounded-[9px] px-3 py-2 text-[13px] font-medium"
                    style={{ backgroundColor: `${SCHEDULED_ACCENT}14`, color: SCHEDULED_ACCENT }}
                  >
                    {describeRecurrenceRule(
                      buildRecurrenceRule({
                        frequency: values.recurrenceFrequency,
                        interval: Number(values.recurrenceInterval) || 1,
                        weekdays: values.recurrenceWeekdays,
                        monthDay: Number(values.recurrenceMonthDay) || 1,
                        hour: values.recurrenceHour,
                        minute: values.recurrenceMinute,
                        timezone: values.recurrenceTimezone || browserTimezone(),
                      }),
                    )}
                  </p>
                </>
              )}
              </>
              )}
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
    </Dialog>
  );
}
