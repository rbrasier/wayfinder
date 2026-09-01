"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, Eye, MoreHorizontal, Upload } from "lucide-react";
import { shouldPreviewByDefault, type ExtractionSchema, type FlowContextDoc } from "@rbrasier/domain";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/trpc/client";
import { DeleteSynthesisDialog, SystemPromptDialog } from "./editor-cards-dialogs";
import { UploadTree, type UploadedFile } from "./upload-tree";
import { ExtractionFieldEditor } from "./extraction-field-editor";
import { SchemaGeneratorOverlay } from "./schema-generator-overlay";
import { readFileAsBase64 } from "@/lib/read-file-base64";
import { FocusCard, Segmented, Switch } from "./editor-cards-controls";
import {
  deriveOutputMode,
  emptyExtractionField,
  extractionFieldToDraft,
  proposalDraftsToFieldModels,
  schemaToFieldModels,
  templateFieldToModel,
  type ExtractionFieldModel,
  type OutputMode,
} from "./extraction-editor-model";

type Cardinality = "one_per_file" | "many_per_record";
type FocusedCard = "input" | "output";

// Template output is being trialled for supersession by the schema generator —
// an author who hands over the document they already produce gets the same
// result without the template plumbing. The mode itself stays: a saved template
// still loads, still parses and still runs, and nothing about it is removed
// until the trial says the generator covers the ground. Only the way to newly
// choose it is withheld, so nobody starts down a path that may not survive.
const TEMPLATE_OUTPUT_SELECTABLE = false;

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

  // The schema generator is offered once, the first time the output card opens.
  // Either choice answers it for the rest of the session; "Generate from sample"
  // beside the field list is the way back to it.
  const [generatorOffered, setGeneratorOffered] = useState(false);
  const [generatorOpen, setGeneratorOpen] = useState(false);

  const focusOutput = (): void => {
    setFocused("output");
    if (generatorOffered) return;
    setGeneratorOffered(true);
    setGeneratorOpen(true);
  };

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
  // Whole-flow context material every extraction is grounded on (item: output
  // context upload). Kept apart from the input documents (which are the records).
  const [contextDocs, setContextDocs] = useState<FlowContextDoc[]>(
    initialSchema?.output.contextDocs ?? [],
  );

  // Input documents are persisted server-side (progressive upload), so the tree
  // reflects the saved intake rather than transient in-memory state.
  const draftDocsQuery = trpc.extraction.listDraftDocuments.useQuery({ flowId });
  const uploads: UploadedFile[] = useMemo(
    () =>
      (draftDocsQuery.data ?? []).map((document) => ({
        id: document.id,
        name: document.filename,
        path: document.treePath,
        mimeType: document.mimeType,
      })),
    [draftDocsQuery.data],
  );

  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [promptLoading, setPromptLoading] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const templateInputRef = useRef<HTMLInputElement | null>(null);
  const contextInputRef = useRef<HTMLInputElement | null>(null);

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
      contextDocs,
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

  const invalidateDraftDocs = () => void utils.extraction.listDraftDocuments.invalidate({ flowId });

  const uploadDraftMutation = trpc.extraction.uploadDraftDocuments.useMutation({
    onSuccess: invalidateDraftDocs,
    onError: (error) => toast.error(error.message),
  });

  const removeDraftMutation = trpc.extraction.removeDraftDocument.useMutation({
    onSuccess: invalidateDraftDocs,
    onError: (error) => toast.error(error.message),
  });

  const startSampleMutation = trpc.extraction.startSample.useMutation({
    onSuccess: ({ runId }) => router.push(`/synthesise/${flowId}/runs/${runId}`),
    onError: (error) => toast.error(error.message),
  });

  const parseContextDocMutation = trpc.extraction.parseContextDoc.useMutation({
    onSuccess: (data) => {
      setContextDocs((current) => [...current, data.contextDoc]);
      toast.success(`Context document added — ${data.contextDoc.filename}`);
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

  const templateModeSelectable = TEMPLATE_OUTPUT_SELECTABLE || outputMode === "template";

  const handleSave = (): void => {
    if (!canSave) {
      toast.error("Upload a template before saving, or switch to structured output.");
      return;
    }
    saveMutation.mutate({ flowId, schema: buildSchemaInput() });
  };

  const handleUploadSamples = async (fileList: FileList | null): Promise<void> => {
    if (!fileList) return;
    const files: { filename: string; treePath: string; mimeType: string; contentBase64: string }[] = [];
    for (const file of Array.from(fileList)) {
      const contentBase64 = await readFileAsBase64(file);
      const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      files.push({
        filename: file.name,
        treePath: path,
        mimeType: file.type || "application/octet-stream",
        contentBase64,
      });
    }
    // Auto-save on upload — the intake persists without a separate Save step.
    if (files.length > 0) uploadDraftMutation.mutate({ flowId, files });
  };

  const handleRemoveDraft = (file: UploadedFile): void => {
    if (file.id) removeDraftMutation.mutate({ documentId: file.id });
  };

  const handleUploadContextDoc = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    const contentBase64 = await readFileAsBase64(file);
    parseContextDocMutation.mutate({
      flowId,
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      contentBase64,
    });
  };

  const handleUploadTemplate = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setTemplateError(null);
    const contentBase64 = await readFileAsBase64(file);
    parseTemplateMutation.mutate({ flowId, filename: file.name, contentBase64 });
  };

  const handleRunSample = (): void => {
    if (uploads.length === 0) {
      toast.error("Upload one or more documents in the input card to sample.");
      return;
    }
    if (!canSave) {
      toast.error("Upload a template before running, or switch to structured output.");
      return;
    }
    // Save the schema, then start a durable run over the draft and its persisted
    // input documents; the run screen shows progress and the results.
    saveMutation.mutate(
      { flowId, schema: buildSchemaInput() },
      { onSuccess: () => startSampleMutation.mutate({ flowId }) },
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

  const sampleStarting = startSampleMutation.isPending || saveMutation.isPending;
  const runSampleButton = (
    <Button type="button" size="sm" onClick={handleRunSample} disabled={sampleStarting}>
      {sampleStarting ? "Starting…" : "Run sample"}
    </Button>
  );

  // Confirming a proposal writes the whole schema, so the card needs the input
  // and output config exactly as Save would send it.
  const schemaInput = buildSchemaInput();

  const outputHeaderActions = (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        aria-label="View system prompt"
        title="View the system prompt each extraction is given"
        onClick={() => void handleViewSystemPrompt()}
        className="rounded-md p-1 text-[#666055] transition-colors hover:bg-[#f5f3ee] hover:text-[#1c1b19]"
      >
        <Eye size={15} />
      </button>
      {runSampleButton}
    </div>
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-[#e7e3db] bg-white pl-5 pr-[52px]">
        <div className="flex items-center gap-2">
          <Link
            href="/synthesise"
            aria-label="Back to Synthesise Information"
            className="flex h-7 w-7 items-center justify-center rounded-[7px] text-[#666055] transition-colors hover:bg-[#f5f3ee] hover:text-[#1c1b19]"
          >
            <ChevronLeft size={16} />
          </Link>
          <h1 className="text-[16px] font-bold tracking-[-0.3px] text-[#1c1b19]">Edit synthesis</h1>
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
              <div className="absolute right-0 top-full z-50 mt-1 w-44 rounded-[9px] border border-[#e7e3db] bg-white py-1 shadow-md">
                <Link
                  href={`/synthesise/${flowId}/runs`}
                  className="block px-3 py-2 text-left text-[13px] text-[#1c1b19] hover:bg-[#f5f3ee]"
                  onClick={() => setMenuOpen(false)}
                >
                  Runs
                </Link>
                <div className="my-1 border-t border-[#e7e3db]" />
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left text-[13px] text-[#a8324c] hover:bg-[#fdf3f5]"
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
            <p className="text-[13px] text-[#736d5f]">Loading…</p>
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
                        <Upload className="h-[18px] w-[18px] text-[#736d5f]" />
                        <span className="text-[13px] font-medium text-[#5c574c]">
                          Upload documents or a zip
                        </span>
                        <span className="text-[11px] text-[#736d5f]">Folder structure is preserved.</span>
                        <input
                          id="sample-upload"
                          type="file"
                          multiple
                          className="sr-only"
                          onChange={(event) => void handleUploadSamples(event.target.files)}
                        />
                      </label>
                      <UploadTree files={uploads} onRemove={handleRemoveDraft} />
                    </div>
                  </div>
                </FocusCard>

                <FocusCard
                  side="output"
                  title="Output — records"
                  focused={focused === "output"}
                  onFocus={focusOutput}
                  headerAction={outputHeaderActions}
                  overlay={
                    generatorOpen ? (
                      <SchemaGeneratorOverlay
                        flowId={flowId}
                        input={schemaInput.input}
                        output={schemaInput.output}
                        onConfigureManually={() => {
                          setOutputMode("structured");
                          setGeneratorOpen(false);
                        }}
                        onConfirmed={(fields, draftedInstruction) => {
                          setManualFields(proposalDraftsToFieldModels(fields));
                          // A blank draft leaves what the author already wrote
                          // alone; overwriting it with nothing is not a draft.
                          if (draftedInstruction) setOutputInstruction(draftedInstruction);
                          setOutputMode("structured");
                          setGeneratorOpen(false);
                        }}
                      />
                    ) : null
                  }
                >
                  <div className="space-y-4">
                    {/* The mode toggle only appears for a flow already on a
                        template: while the generator is being trialled there is
                        no way to newly choose template output, but a flow that
                        has one keeps its way back to structured. */}
                    {templateModeSelectable && (
                      <Segmented
                        label="Output"
                        value={outputMode}
                        onChange={(value) => setOutputMode(value as OutputMode)}
                        options={[
                          { value: "structured", label: "Structured output" },
                          { value: "template", label: "Template" },
                        ]}
                      />
                    )}

                    {outputMode === "structured" ? (
                      <ExtractionFieldEditor
                        fields={manualFields}
                        onChange={setManualFields}
                        headerAction={
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => setGeneratorOpen(true)}
                          >
                            Generate from sample
                          </Button>
                        }
                      />
                    ) : (
                      <div className="space-y-3">
                        <p className="rounded-[9px] border border-[#c3cef2] bg-[#eaeefb] px-3 py-2 text-[12px] text-[#2f56d3]">
                          Spreadsheets should include a header row naming each field. Word templates use{" "}
                          <code className="font-mono">{"{{ tags }}"}</code>. Those become the fields to extract.
                        </p>
                        {outputTemplate ? (
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2 rounded-[9px] border border-[#c0e8d5] bg-[#e3efe5] px-3 py-2">
                              <span className="flex-1 truncate text-[12px] text-[#1f6b4d]">
                                {outputTemplate.filename}
                              </span>
                              <button
                                type="button"
                                className="shrink-0 text-[12px] text-[#666055] hover:text-[#5c574c]"
                                onClick={() => templateInputRef.current?.click()}
                                disabled={parseTemplateMutation.isPending}
                              >
                                Replace
                              </button>
                              <button
                                type="button"
                                className="shrink-0 text-[12px] text-[#a8324c] hover:text-[#a02e4b]"
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
                              <p className="text-[12px] text-[#666055]">
                                Spreadsheet detected —{" "}
                                <span className="font-medium text-[#1f6b4d]">
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
                            className="w-full rounded-[9px] border border-dashed border-[#e7e3db] bg-[#faf9f7] p-4 text-center text-[13px] text-[#666055] transition-colors hover:border-[#c3cef2] hover:bg-[#eaeefb] hover:text-[#2f56d3] disabled:opacity-50"
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
                        {templateError && <p className="text-[12px] text-[#a8324c]">{templateError}</p>}
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

                    <div className="space-y-1.5">
                      {/* A section heading, not a control label: pointing a <label
                          for> at the upload button would override its accessible
                          name (a button is labelable, and the label wins over the
                          button's own text). */}
                      <span className="text-[13px] font-medium text-[#3d382f]">Context material</span>
                      <p className="text-[12px] text-[#666055]">
                        Reference documents every extraction is grounded on — e.g. evaluation
                        criteria or a scoring rubric. The equivalent of whole-flow context.
                      </p>
                      {contextDocs.length > 0 && (
                        <ul className="space-y-1">
                          {contextDocs.map((doc) => (
                            <li
                              key={doc.id}
                              className="flex items-center gap-2 rounded-[9px] border border-[#e7e3db] bg-[#faf9f6] px-3 py-2"
                            >
                              <span className="flex-1 truncate text-[12px] text-[#5c574c]">
                                {doc.filename}
                              </span>
                              {doc.extractionStatus === "failed" && (
                                <span className="shrink-0 text-[11px] text-[#8a5a1d]">no text</span>
                              )}
                              <button
                                type="button"
                                aria-label={`Remove ${doc.filename}`}
                                className="shrink-0 text-[12px] text-[#a8324c] hover:text-[#a02e4b]"
                                onClick={() =>
                                  setContextDocs((current) => current.filter((entry) => entry.id !== doc.id))
                                }
                              >
                                Remove
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      <button
                        type="button"
                        className="w-full rounded-[9px] border border-dashed border-[#e7e3db] bg-[#faf9f7] p-3 text-center text-[13px] text-[#666055] transition-colors hover:border-[#c3cef2] hover:bg-[#eaeefb] hover:text-[#2f56d3] disabled:opacity-50"
                        onClick={() => contextInputRef.current?.click()}
                        disabled={parseContextDocMutation.isPending}
                      >
                        {parseContextDocMutation.isPending ? "Reading…" : "Add a context document"}
                      </button>
                      <input
                        ref={contextInputRef}
                        type="file"
                        accept=".docx,.pdf,.txt,.md,.csv"
                        className="sr-only"
                        onChange={(event) => {
                          void handleUploadContextDoc(event.target.files?.[0]);
                          event.target.value = "";
                        }}
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

              <p className="mt-3 text-[12px] text-[#736d5f]">
                Preview is {previewOn ? "on" : "off"} by default
                {uploads.length > 0 ? ` (${uploads.length} file${uploads.length === 1 ? "" : "s"})` : ""}. A
                sample processes the first few documents and pauses; open the run to see results and
                process the rest.
              </p>
            </>
          )}
        </div>
      </div>

      <SystemPromptDialog
        open={promptOpen}
        onOpenChange={setPromptOpen}
        loading={promptLoading}
        error={promptError}
        systemPrompt={systemPrompt}
      />

      <DeleteSynthesisDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        deleting={deleteMutation.isPending}
        onDelete={() => deleteMutation.mutate({ flowId })}
      />
    </div>
  );
}
