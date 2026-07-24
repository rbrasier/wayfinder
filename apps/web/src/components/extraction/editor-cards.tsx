"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, Eye, MoreHorizontal, Upload } from "lucide-react";
import { shouldPreviewByDefault, type ExtractionSchema, type FlowContextDoc } from "@rbrasier/domain";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/trpc/client";
import { CopyButton } from "@/components/canvas/node-config-modal-helpers";
import { UploadTree, type UploadedFile } from "./upload-tree";
import { ResultGrid, type SampleResult } from "./result-grid";
import { ExtractionFieldEditor } from "./extraction-field-editor";
import {
  deriveOutputMode,
  emptyExtractionField,
  extractionFieldToDraft,
  schemaToFieldModels,
  templateFieldToModel,
  type ExtractionFieldModel,
  type OutputMode,
} from "./extraction-editor-model";

type Cardinality = "one_per_file" | "many_per_record";
type FocusedCard = "input" | "output";

const readFileAsBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the "data:<mime>;base64," prefix.
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

export function EditorCards({
  flowId,
  initialSchema,
  isLoading = false,
}: {
  flowId: string;
  initialSchema: ExtractionSchema | null;
  isLoading?: boolean;
}) {
  const router = useRouter();
  const utils = trpc.useUtils();

  const initialMode = deriveOutputMode(initialSchema);

  const [focused, setFocused] = useState<FocusedCard>("input");

  // Input config.
  const [guidance, setGuidance] = useState(initialSchema?.input.guidance ?? "");
  const [cardinality, setCardinality] = useState<Cardinality>(
    initialSchema?.input.cardinality ?? "one_per_file",
  );
  const [selectionCriteria, setSelectionCriteria] = useState(
    initialSchema?.input.selectionCriteria ?? "",
  );

  // Output config. Manual (structured) and template-derived field sets are kept
  // apart so toggling output mode never loses the other's work.
  const [outputMode, setOutputMode] = useState<OutputMode>(initialMode);
  const [manualFields, setManualFields] = useState<ExtractionFieldModel[]>(
    initialMode === "structured" ? schemaToFieldModels(initialSchema, false) : [emptyExtractionField()],
  );
  const [templateFields, setTemplateFields] = useState<ExtractionFieldModel[]>(
    initialMode === "template" ? schemaToFieldModels(initialSchema, true) : [],
  );
  const [outputTemplate, setOutputTemplate] = useState<FlowContextDoc | null>(
    initialSchema?.output.outputTemplate ?? null,
  );
  const [templateFormat, setTemplateFormat] = useState<"docx" | "xlsx">(
    initialSchema?.output.format ?? "xlsx",
  );
  const [templateMode, setTemplateMode] = useState<"tags" | "header" | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [outputInstruction, setOutputInstruction] = useState(initialSchema?.output.instruction ?? "");
  const [generateSummary, setGenerateSummary] = useState(initialSchema?.output.generateSummary ?? false);

  const [uploads, setUploads] = useState<UploadedFile[]>([]);
  const [sample, setSample] = useState<SampleResult | null>(null);

  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [promptLoading, setPromptLoading] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const templateInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  const previewOn = useMemo(() => shouldPreviewByDefault(uploads.length), [uploads.length]);

  const activeFields = outputMode === "template" ? templateFields : manualFields;

  const buildSchemaInput = () => ({
    fields: activeFields
      .filter((field) => field.label.trim().length > 0)
      .map(extractionFieldToDraft),
    input: {
      cardinality,
      selectionCriteria: cardinality === "many_per_record" ? selectionCriteria : null,
      guidance,
    },
    output: {
      format: outputMode === "template" ? templateFormat : ("xlsx" as const),
      outputTemplate: outputMode === "template" ? outputTemplate : null,
      instruction: outputInstruction,
      generateSummary,
      summaryTemplate: null,
      contextDocs: [],
    },
  });

  const saveMutation = trpc.extraction.saveSchema.useMutation({
    onSuccess: () => {
      void utils.extraction.getSchema.invalidate({ flowId });
      toast.success("Saved");
    },
    onError: (error) => toast.error(error.message),
  });

  const parseTemplateMutation = trpc.extraction.parseOutputTemplate.useMutation({
    onSuccess: (data) => {
      setOutputTemplate(data.template);
      setTemplateFormat(data.format);
      setTemplateMode(data.spreadsheetTemplateMode);
      setTemplateFields(
        data.fields.map((field) => templateFieldToModel(field, { instruction: "", locked: true })),
      );
      setTemplateError(null);
      toast.success(`Template read — ${data.fields.length} field${data.fields.length === 1 ? "" : "s"} found`);
    },
    onError: (error) => setTemplateError(error.message),
  });

  const runSampleMutation = trpc.extraction.runSample.useMutation({
    onSuccess: (data) => {
      setSample(data as SampleResult);
      toast.success("Sample extracted");
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteMutation = trpc.extraction.delete.useMutation({
    onSuccess: () => {
      void utils.extraction.listMine.invalidate();
      toast.success("Synthesis deleted");
      router.push("/synthesise");
    },
    onError: (error) => toast.error(error.message),
  });

  const canSave = outputMode === "structured" || outputTemplate !== null;

  const handleSave = (): void => {
    if (!canSave) {
      toast.error("Upload a template before saving, or switch to structured output.");
      return;
    }
    saveMutation.mutate({ flowId, schema: buildSchemaInput() });
  };

  const handleUploadSamples = async (fileList: FileList | null): Promise<void> => {
    if (!fileList) return;
    const next: UploadedFile[] = [];
    for (const file of Array.from(fileList)) {
      const contentBase64 = await readFileAsBase64(file);
      const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      next.push({ name: file.name, path, mimeType: file.type || "application/octet-stream", contentBase64 });
    }
    setUploads((current) => [...current, ...next]);
  };

  const handleUploadTemplate = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setTemplateError(null);
    const contentBase64 = await readFileAsBase64(file);
    parseTemplateMutation.mutate({ flowId, filename: file.name, contentBase64 });
  };

  const handleRunSample = (): void => {
    if (uploads.length === 0) {
      toast.error("Upload one to three documents in the input card to sample.");
      return;
    }
    if (!canSave) {
      toast.error("Upload a template before running, or switch to structured output.");
      return;
    }
    saveMutation.mutate(
      { flowId, schema: buildSchemaInput() },
      {
        onSuccess: () => {
          runSampleMutation.mutate({
            flowId,
            documents: uploads.slice(0, 3).map((file) => ({
              filename: file.name,
              treePath: file.path,
              mimeType: file.mimeType,
              contentBase64: file.contentBase64,
            })),
          });
        },
      },
    );
  };

  const handleViewSystemPrompt = async (): Promise<void> => {
    setPromptOpen(true);
    setPromptError(null);
    setSystemPrompt(null);
    setPromptLoading(true);
    try {
      const result = await utils.extraction.previewSystemPrompt.fetch({
        flowId,
        schema: buildSchemaInput(),
      });
      setSystemPrompt(result.systemPrompt);
    } catch (error) {
      setPromptError(error instanceof Error ? error.message : "Could not build the system prompt.");
    } finally {
      setPromptLoading(false);
    }
  };

  const runSampleButton = (
    <Button
      type="button"
      size="sm"
      onClick={handleRunSample}
      disabled={runSampleMutation.isPending || saveMutation.isPending}
    >
      {runSampleMutation.isPending ? "Extracting…" : "Run sample"}
    </Button>
  );

  const outputHeaderActions = (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        aria-label="View system prompt"
        title="View the system prompt each extraction is given"
        onClick={() => void handleViewSystemPrompt()}
        className="rounded-md p-1 text-[#6d6a65] transition-colors hover:bg-[#efede8] hover:text-[#1a1814]"
      >
        <Eye size={15} />
      </button>
      {runSampleButton}
    </div>
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-[#dedad2] bg-white pl-5 pr-[52px]">
        <div className="flex items-center gap-2">
          <Link
            href="/synthesise"
            aria-label="Back to Synthesise Information"
            className="flex h-7 w-7 items-center justify-center rounded-[7px] text-[#6d6a65] transition-colors hover:bg-[#efede8] hover:text-[#1a1814]"
          >
            <ChevronLeft size={16} />
          </Link>
          <h1 className="text-[16px] font-bold tracking-[-0.3px] text-[#1a1814]">Edit synthesis</h1>
        </div>
        <div className="flex items-center gap-2">
          {/* Publish is intentionally disabled until its behaviour is defined. */}
          <Button type="button" variant="outline" size="sm" disabled title="Publishing is not available yet">
            Publish
          </Button>
          <Button type="button" size="sm" onClick={handleSave} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? "Saving…" : "Save"}
          </Button>
          <div className="relative" ref={menuRef}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="Synthesis actions"
              className="px-2"
              onClick={() => setMenuOpen((open) => !open)}
            >
              <MoreHorizontal size={16} />
            </Button>
            {menuOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 w-44 rounded-[9px] border border-[#dedad2] bg-white py-1 shadow-md">
                <Link
                  href={`/synthesise/${flowId}/runs`}
                  className="block px-3 py-2 text-left text-[13px] text-[#1a1814] hover:bg-[#efede8]"
                  onClick={() => setMenuOpen(false)}
                >
                  Runs
                </Link>
                <div className="my-1 border-t border-[#dedad2]" />
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left text-[13px] text-[#c2385a] hover:bg-[#fdf3f5]"
                  onClick={() => {
                    setMenuOpen(false);
                    setDeleteOpen(true);
                  }}
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-[1200px] px-5 py-6">
          {isLoading ? (
            <p className="text-[13px] text-[#8a857c]">Loading…</p>
          ) : (
            <>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                <FocusCard
                  side="input"
                  title="Input — documents"
                  focused={focused === "input"}
                  onFocus={() => setFocused("input")}
                >
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="read-instructions">How should the AI read these documents?</Label>
                      <Textarea
                        id="read-instructions"
                        value={guidance}
                        onChange={(event) => setGuidance(event.target.value)}
                        placeholder="e.g. Each file is one supplier's tender response."
                        rows={2}
                      />
                    </div>

                    <Segmented
                      label="How do files map to records?"
                      value={cardinality}
                      onChange={(value) => setCardinality(value as Cardinality)}
                      options={[
                        { value: "one_per_file", label: "One file → one record" },
                        { value: "many_per_record", label: "Many files → one record" },
                      ]}
                    />

                    {cardinality === "many_per_record" && (
                      <div className="space-y-1.5">
                        <Label htmlFor="selection-criteria">Which files make up one record?</Label>
                        <Textarea
                          id="selection-criteria"
                          value={selectionCriteria}
                          onChange={(event) => setSelectionCriteria(event.target.value)}
                          placeholder="e.g. All files sharing a filename prefix, or all files in the same sub-folder."
                          rows={2}
                        />
                      </div>
                    )}

                    <div>
                      <label
                        htmlFor="sample-upload"
                        className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[10px] border-2 border-dashed border-[#d7d2c8] bg-[#faf9f6] px-3 py-6 text-center"
                      >
                        <Upload className="h-[18px] w-[18px] text-[#8a857c]" />
                        <span className="text-[13px] font-medium text-[#5a5650]">
                          Upload documents or a zip
                        </span>
                        <span className="text-[11px] text-[#8a857c]">Folder structure is preserved.</span>
                        <input
                          id="sample-upload"
                          type="file"
                          multiple
                          className="sr-only"
                          onChange={(event) => void handleUploadSamples(event.target.files)}
                        />
                      </label>
                      <UploadTree files={uploads} />
                    </div>
                  </div>
                </FocusCard>

                <FocusCard
                  side="output"
                  title="Output — records"
                  focused={focused === "output"}
                  onFocus={() => setFocused("output")}
                  headerAction={outputHeaderActions}
                >
                  <div className="space-y-4">
                    <Segmented
                      label="Output"
                      value={outputMode}
                      onChange={(value) => setOutputMode(value as OutputMode)}
                      options={[
                        { value: "structured", label: "Structured output" },
                        { value: "template", label: "Template" },
                      ]}
                    />

                    {outputMode === "structured" ? (
                      <ExtractionFieldEditor fields={manualFields} onChange={setManualFields} />
                    ) : (
                      <div className="space-y-3">
                        <p className="rounded-[9px] border border-[#c5d0f7] bg-[#eef1fc] px-3 py-2 text-[12px] text-[#3a5fd9]">
                          Spreadsheets should include a header row naming each field. Word templates use{" "}
                          <code className="font-mono">{"{{ tags }}"}</code>. Those become the fields to extract.
                        </p>
                        {outputTemplate ? (
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2 rounded-[9px] border border-[#c0e8d5] bg-[#eaf6f0] px-3 py-2">
                              <span className="flex-1 truncate text-[12px] text-[#247c53]">
                                {outputTemplate.filename}
                              </span>
                              <button
                                type="button"
                                className="shrink-0 text-[12px] text-[#6d6a65] hover:text-[#5a5650]"
                                onClick={() => templateInputRef.current?.click()}
                                disabled={parseTemplateMutation.isPending}
                              >
                                Replace
                              </button>
                              <button
                                type="button"
                                className="shrink-0 text-[12px] text-[#c2385a] hover:text-[#a02e4b]"
                                onClick={() => {
                                  setOutputTemplate(null);
                                  setTemplateFields([]);
                                  setTemplateMode(null);
                                  setTemplateError(null);
                                }}
                                disabled={parseTemplateMutation.isPending}
                              >
                                Remove
                              </button>
                            </div>
                            {templateFormat === "xlsx" && templateMode && (
                              <p className="text-[12px] text-[#6d6a65]">
                                Spreadsheet detected —{" "}
                                <span className="font-medium text-[#247c53]">
                                  {templateMode === "tags" ? "Tag mode" : "Header-row mode"}
                                </span>
                                {templateMode === "tags"
                                  ? " (its {{ tags }} become the fields)"
                                  : " (its header row becomes the fields)"}
                              </p>
                            )}
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="w-full rounded-[9px] border border-dashed border-[#dedad2] bg-[#f7f6f3] p-4 text-center text-[13px] text-[#6d6a65] transition-colors hover:border-[#c5d0f7] hover:bg-[#eef1fc] hover:text-[#3a5fd9] disabled:opacity-50"
                            onClick={() => templateInputRef.current?.click()}
                            disabled={parseTemplateMutation.isPending}
                          >
                            {parseTemplateMutation.isPending
                              ? "Reading template…"
                              : "Click to upload a .docx or .xlsx template"}
                          </button>
                        )}
                        <input
                          ref={templateInputRef}
                          type="file"
                          accept=".docx,.xlsx"
                          className="sr-only"
                          onChange={(event) => void handleUploadTemplate(event.target.files?.[0])}
                        />
                        {templateError && <p className="text-[12px] text-[#c2385a]">{templateError}</p>}
                        {outputTemplate && (
                          <ExtractionFieldEditor fields={templateFields} onChange={setTemplateFields} derived />
                        )}
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <Label htmlFor="output-instruction">Output instructions</Label>
                      <Textarea
                        id="output-instruction"
                        value={outputInstruction}
                        onChange={(event) => setOutputInstruction(event.target.value)}
                        placeholder="e.g. One row per supplier, sorted by contract value."
                        rows={2}
                      />
                    </div>

                    <Switch
                      id="generate-summary"
                      label="Also generate a summary document"
                      description="A short written overview alongside the records."
                      checked={generateSummary}
                      onChange={setGenerateSummary}
                    />
                  </div>
                </FocusCard>
              </div>

              <p className="mt-3 text-[12px] text-[#8a857c]">
                Preview is {previewOn ? "on" : "off"} by default
                {uploads.length > 0 ? ` (${uploads.length} file${uploads.length === 1 ? "" : "s"})` : ""}. A
                sample runs over up to 3 documents.
              </p>

              {sample && (
                <div className="mt-6">
                  <h2 className="mb-2.5 text-[15px] font-semibold text-[#1a1814]">Sample results</h2>
                  <ResultGrid result={sample} />
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <Dialog open={promptOpen} onOpenChange={setPromptOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Extraction system prompt</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody className="max-h-[70vh] overflow-hidden">
            {promptLoading ? (
              <p className="text-[13px] text-[#8a857c]">Building…</p>
            ) : promptError ? (
              <p className="text-[13px] text-[#c2385a]">{promptError}</p>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-[12px] text-[#6d6a65]">
                    System prompt given to the AI for each document extraction (read-only)
                  </p>
                  <CopyButton text={systemPrompt ?? ""} />
                </div>
                <pre className="max-h-[56vh] flex-1 overflow-y-auto whitespace-pre-wrap rounded-[9px] border border-[#dedad2] bg-[#f7f6f3] p-3 font-mono text-[12px] leading-[1.6] text-[#1a1814]">
                  {systemPrompt}
                </pre>
              </>
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this synthesis?</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody>
            <DialogDescription>
              This removes the synthesis and its schema. Past runs are retained but it can no longer be
              edited or run. This cannot be undone.
            </DialogDescription>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate({ flowId })}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// A large card that either holds focus (enlarged, raised, overlapping its
// sibling) or sits behind a frosted overlay inviting the author to configure it.
function FocusCard({
  side,
  title,
  focused,
  onFocus,
  headerAction,
  children,
}: {
  side: FocusedCard;
  title: string;
  focused: boolean;
  onFocus: () => void;
  headerAction?: ReactNode;
  children: ReactNode;
}) {
  const overlapClass = focused
    ? side === "input"
      ? "lg:mr-[-28px]"
      : "lg:ml-[-28px]"
    : "";

  return (
    <section
      className={`relative rounded-[14px] border bg-white transition-all duration-200 ${
        focused
          ? `z-20 flex-[1.75] border-[#c5d0f7] shadow-[0_12px_36px_rgba(58,95,217,0.14)] ${overlapClass}`
          : "z-10 flex-[1] border-[#e5e1d8] shadow-sm"
      }`}
    >
      <div className="flex items-center justify-between border-b border-[#f0ede7] px-5 py-3.5">
        <h2 className="text-[15px] font-semibold text-[#1a1814]">{title}</h2>
        {focused && headerAction}
      </div>
      <div className={`p-5 ${focused ? "" : "pointer-events-none select-none"}`}>{children}</div>

      {!focused && (
        <button
          type="button"
          aria-label={`Configure ${side}`}
          onClick={onFocus}
          className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-[14px] bg-white/55 text-center backdrop-blur-[3px] transition-colors hover:bg-white/40"
        >
          <span className="text-[14px] font-semibold text-[#1a1814]">
            Configure {side === "input" ? "input" : "output"}
          </span>
          <span className="text-[12px] text-[#6d6a65]">Click here to configure</span>
        </button>
      )}
    </section>
  );
}

// A segmented, toggle-style two-option control matching the node-config look —
// used in place of radio groups.
function Segmented({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="space-y-1.5">
      <span className="text-[13px] font-medium text-[#3a352e]">{label}</span>
      <div className="flex gap-2" role="radiogroup" aria-label={label}>
        {options.map((option) => {
          const active = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(option.value)}
              className={`flex flex-1 items-center justify-center rounded-[9px] border px-3 py-2 text-center text-[13px] transition-colors ${
                active
                  ? "border-[#3a5fd9] bg-[#eef1fc] font-medium text-[#3a5fd9]"
                  : "border-[#dedad2] text-[#5a5650] hover:bg-[#efede8]"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// The node-config switch, reused so the extraction editor's on/off controls read
// identically to the rest of the app.
function Switch({
  id,
  label,
  description,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="space-y-0.5">
        <Label htmlFor={id}>{label}</Label>
        <p className="text-[12px] text-[#6d6a65]">{description}</p>
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative mt-1 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          checked ? "bg-[#1f8a4c]" : "bg-[#d7d3cc]"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            checked ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}
