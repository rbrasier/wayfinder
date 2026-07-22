"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Plus, Trash2, Upload } from "lucide-react";
import { shouldPreviewByDefault, type ExtractionSchema } from "@rbrasier/domain";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/trpc/client";
import { UploadTree, type UploadedFile } from "./upload-tree";
import { ResultGrid, type SampleResult } from "./result-grid";

type Cardinality = "one_per_file" | "many_per_record";
type OutputFormat = "docx" | "xlsx";

interface FieldRow {
  label: string;
  annotation: string;
  instruction: string;
  doneWhen: string;
}

const emptyField = (): FieldRow => ({ label: "", annotation: "", instruction: "", doneWhen: "" });

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

const toFieldRows = (schema: ExtractionSchema | null): FieldRow[] => {
  if (!schema || schema.fields.length === 0) return [emptyField()];
  return schema.fields.map((field) => ({
    label: field.field.label,
    annotation: field.field.raw,
    instruction: field.instruction,
    doneWhen: field.doneWhen ?? "",
  }));
};

export function EditorCards({
  flowId,
  initialSchema,
}: {
  flowId: string;
  initialSchema: ExtractionSchema | null;
}) {
  const utils = trpc.useUtils();
  const [fields, setFields] = useState<FieldRow[]>(toFieldRows(initialSchema));
  const [cardinality, setCardinality] = useState<Cardinality>(
    initialSchema?.input.cardinality ?? "one_per_file",
  );
  const [selectionCriteria, setSelectionCriteria] = useState(
    initialSchema?.input.selectionCriteria ?? "",
  );
  const [guidance, setGuidance] = useState(initialSchema?.input.guidance ?? "");
  const [outputFormat, setOutputFormat] = useState<OutputFormat>(
    initialSchema?.output.format ?? "xlsx",
  );
  const [outputInstruction, setOutputInstruction] = useState(
    initialSchema?.output.instruction ?? "",
  );
  const [generateSummary, setGenerateSummary] = useState(
    initialSchema?.output.generateSummary ?? false,
  );
  const [uploads, setUploads] = useState<UploadedFile[]>([]);
  const [sample, setSample] = useState<SampleResult | null>(null);

  const previewOn = useMemo(() => shouldPreviewByDefault(uploads.length), [uploads.length]);

  const buildSchemaInput = () => ({
    fields: fields
      .filter((field) => field.label.trim().length > 0)
      .map((field) => ({
        label: field.label.trim(),
        annotation: field.annotation.trim() || field.label.trim(),
        instruction: field.instruction,
        doneWhen: field.doneWhen.trim() ? field.doneWhen.trim() : null,
      })),
    input: {
      cardinality,
      selectionCriteria: cardinality === "many_per_record" ? selectionCriteria : null,
      guidance,
    },
    output: {
      format: outputFormat,
      outputTemplate: null,
      instruction: outputInstruction,
      generateSummary,
      summaryTemplate: null,
      contextDocs: [],
    },
  });

  const saveMutation = trpc.extraction.saveSchema.useMutation({
    onSuccess: () => {
      void utils.extraction.getSchema.invalidate({ flowId });
      toast.success("Schema saved");
    },
    onError: (error) => toast.error(error.message),
  });

  const runSampleMutation = trpc.extraction.runSample.useMutation({
    onSuccess: (data) => {
      setSample(data as SampleResult);
      toast.success("Sample extracted");
    },
    onError: (error) => toast.error(error.message),
  });

  const handleUpload = async (fileList: FileList | null): Promise<void> => {
    if (!fileList) return;
    const next: UploadedFile[] = [];
    for (const file of Array.from(fileList)) {
      const contentBase64 = await readFileAsBase64(file);
      const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      next.push({ name: file.name, path, mimeType: file.type || "application/octet-stream", contentBase64 });
    }
    setUploads((current) => [...current, ...next]);
  };

  const handleSave = (): void => {
    saveMutation.mutate({ flowId, schema: buildSchemaInput() });
  };

  const handleRunSample = (): void => {
    if (uploads.length === 0) {
      toast.error("Upload one to three documents to sample.");
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

  const updateField = (index: number, patch: Partial<FieldRow>): void => {
    setFields((current) => current.map((field, i) => (i === index ? { ...field, ...patch } : field)));
  };

  return (
    <div className="flex flex-col gap-[20px]">
      <div className="flex flex-col items-stretch gap-[12px] lg:flex-row">
        {/* Left card — input */}
        <section className="flex-1 rounded-[12px] border border-[#e5e1d8] bg-white p-[16px]">
          <h2 className="text-[15px] font-semibold text-[#1a1814]">Input — documents</h2>

          {/* Top half — how to read + cardinality */}
          <div className="mt-[12px] flex flex-col gap-[10px]">
            <div>
              <Label htmlFor="read-instructions">How should the AI read these documents?</Label>
              <Textarea
                id="read-instructions"
                value={guidance}
                onChange={(event) => setGuidance(event.target.value)}
                placeholder="e.g. Each file is one supplier's tender response."
                rows={2}
              />
            </div>

            <fieldset className="flex flex-col gap-[6px]">
              <legend className="text-[13px] font-medium text-[#3a352e]">
                How do files map to records?
              </legend>
              <label className="flex items-center gap-[8px] text-[13px]">
                <input
                  type="radio"
                  name="cardinality"
                  checked={cardinality === "one_per_file"}
                  onChange={() => setCardinality("one_per_file")}
                />
                One file → one record
              </label>
              <label className="flex items-center gap-[8px] text-[13px]">
                <input
                  type="radio"
                  name="cardinality"
                  checked={cardinality === "many_per_record"}
                  onChange={() => setCardinality("many_per_record")}
                />
                Many files → one record
              </label>
            </fieldset>

            {cardinality === "many_per_record" && (
              <div>
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
          </div>

          {/* Bottom half — upload area + tree */}
          <div className="mt-[14px]">
            <label
              htmlFor="sample-upload"
              className="flex cursor-pointer flex-col items-center justify-center gap-[6px] rounded-[10px] border-2 border-dashed border-[#d7d2c8] bg-[#faf9f6] px-[12px] py-[20px] text-center"
            >
              <Upload className="h-[18px] w-[18px] text-[#8a857c]" />
              <span className="text-[13px] font-medium text-[#5a5650]">
                Upload documents or a zip
              </span>
              <span className="text-[11px] text-[#8a857c]">
                Folder structure is preserved.
              </span>
              <input
                id="sample-upload"
                type="file"
                multiple
                className="sr-only"
                onChange={(event) => void handleUpload(event.target.files)}
              />
            </label>
            <UploadTree files={uploads} />
          </div>
        </section>

        {/* Arrow */}
        <div className="flex items-center justify-center" aria-hidden="true">
          <ArrowRight className="h-[22px] w-[22px] text-[#b6b1a8]" />
        </div>

        {/* Right card — output */}
        <section className="flex-1 rounded-[12px] border border-[#e5e1d8] bg-white p-[16px]">
          <h2 className="text-[15px] font-semibold text-[#1a1814]">Output — records</h2>

          <div className="mt-[12px] flex flex-col gap-[10px]">
            <fieldset className="flex flex-col gap-[6px]">
              <legend className="text-[13px] font-medium text-[#3a352e]">Output format</legend>
              <div className="flex gap-[8px]">
                <Button
                  type="button"
                  variant={outputFormat === "xlsx" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setOutputFormat("xlsx")}
                >
                  Spreadsheet (XLSX)
                </Button>
                <Button
                  type="button"
                  variant={outputFormat === "docx" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setOutputFormat("docx")}
                >
                  Document (Word)
                </Button>
              </div>
            </fieldset>

            <div>
              <Label htmlFor="output-instruction">Output instructions</Label>
              <Textarea
                id="output-instruction"
                value={outputInstruction}
                onChange={(event) => setOutputInstruction(event.target.value)}
                placeholder="e.g. One row per supplier, sorted by contract value."
                rows={2}
              />
            </div>

            <label className="flex items-center gap-[8px] text-[13px]">
              <input
                type="checkbox"
                checked={generateSummary}
                onChange={(event) => setGenerateSummary(event.target.checked)}
              />
              Also generate a summary document
            </label>
          </div>

          {/* Fields the schema pulls */}
          <div className="mt-[14px]">
            <h3 className="text-[13px] font-semibold text-[#3a352e]">Fields to extract</h3>
            <div className="mt-[8px] flex flex-col gap-[10px]">
              {fields.map((field, index) => (
                <div key={index} className="rounded-[9px] border border-[#ece8df] p-[10px]">
                  <div className="flex items-center gap-[8px]">
                    <Input
                      aria-label={`Field ${index + 1} label`}
                      value={field.label}
                      onChange={(event) => updateField(index, { label: event.target.value })}
                      placeholder="Field name, e.g. Supplier Name"
                    />
                    <Input
                      aria-label={`Field ${index + 1} annotation`}
                      value={field.annotation}
                      onChange={(event) => updateField(index, { annotation: event.target.value })}
                      placeholder="Annotation, e.g. Contract Value (currency)"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove field ${index + 1}`}
                      onClick={() =>
                        setFields((current) =>
                          current.length > 1 ? current.filter((_, i) => i !== index) : current,
                        )
                      }
                    >
                      <Trash2 className="h-[14px] w-[14px]" />
                    </Button>
                  </div>
                  <Textarea
                    aria-label={`Field ${index + 1} instruction`}
                    className="mt-[8px]"
                    value={field.instruction}
                    onChange={(event) => updateField(index, { instruction: event.target.value })}
                    placeholder="Plain-English instruction: what should the AI pull for this field?"
                    rows={2}
                  />
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() => setFields((current) => [...current, emptyField()])}
              >
                <Plus className="mr-[4px] h-[14px] w-[14px]" /> Add field
              </Button>
            </div>
          </div>
        </section>
      </div>

      {/* Run control */}
      <div className="flex flex-wrap items-center gap-[12px] rounded-[12px] border border-[#e5e1d8] bg-white p-[16px]">
        <Button type="button" variant="outline" onClick={handleSave} disabled={saveMutation.isPending}>
          Save
        </Button>
        <Button
          type="button"
          onClick={handleRunSample}
          disabled={runSampleMutation.isPending || saveMutation.isPending}
        >
          {runSampleMutation.isPending ? "Extracting…" : "Run sample"}
        </Button>
        <span className="text-[12px] text-[#8a857c]">
          Preview is {previewOn ? "on" : "off"} by default
          {uploads.length > 0 ? ` (${uploads.length} file${uploads.length === 1 ? "" : "s"})` : ""}.
          A sample runs over up to 3 documents.
        </span>
      </div>

      {sample && (
        <div>
          <h2 className="mb-[10px] text-[15px] font-semibold text-[#1a1814]">Sample results</h2>
          <ResultGrid result={sample} />
        </div>
      )}
    </div>
  );
}
