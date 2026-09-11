"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { AlertTriangle, Info, Loader2, Lock, Upload } from "lucide-react";
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
import type { AnnotationRow } from "@/lib/template-annotation";
import { AnnotationReference } from "./annotation-reference";
import { toTemplateError, type TemplateError } from "./template-error-model";
import { AnnotationTypingDemo } from "./annotation-typing-demo";
import { FieldConfigModal, FieldRow } from "./field-row";
import {
  lineToModel,
  modelToLine,
  TEMPLATE_TYPE_OPTIONS,
  withType,
  type FieldModel,
  type FieldRowType,
} from "./field-row-model";
import {
  duplicateCounts,
  rowTypeLabel,
  saveBlockedReason,
  signatureLabelsIn,
  toEditableRows,
  validateRow,
  type AnnotationStep,
  type EditableRow,
  type RowValidation,
  type TemplateClassification,
} from "./template-annotation-model";

interface AnalyseResponse {
  filename: string;
  format: "docx" | "xlsx";
  classification: TemplateClassification;
  documentText: string;
  rows: AnnotationRow[];
}

export interface TemplateAnnotationModalProps {
  file: File | null;
  flowId: string;
  nodeId: string;
  // Re-entry: edit the fields of the template already attached to this node,
  // with no file to re-upload.
  existingRows?: AnnotationRow[] | null;
  onCancel: () => void;
  onSaved: (result: {
    path: string;
    filename: string;
    documentTemplateContent: string | null;
    documentTemplateFormat?: "docx" | "xlsx";
    spreadsheetTemplateMode?: "tags" | "header" | null;
  }) => void;
}

// Strips the client-only fields, leaving the AnnotationRow shape the routes read.
const toPayloadRows = (rows: EditableRow[]): AnnotationRow[] =>
  rows.map(({ id, model, ...row }) => {
    void id;
    void model;
    return row;
  });

export function TemplateAnnotationModal({
  file,
  flowId,
  nodeId,
  existingRows = null,
  onCancel,
  onSaved,
}: TemplateAnnotationModalProps) {
  const isReentry = existingRows !== null;
  const [step, setStep] = useState<AnnotationStep>(isReentry ? "review" : "analysing");
  const [analysis, setAnalysis] = useState<AnalyseResponse | null>(null);
  const [rows, setRows] = useState<EditableRow[]>(() =>
    existingRows ? toEditableRows(existingRows) : [],
  );
  const [error, setError] = useState<TemplateError | null>(null);
  const [configIndex, setConfigIndex] = useState<number | null>(null);
  // The file currently under review. Held in state (not just the prop) so the
  // author can swap it via the re-upload panel and restart the flow in place.
  const [activeFile, setActiveFile] = useState<File | null>(file);
  const analysedRef = useRef(false);
  const reuploadInputRef = useRef<HTMLInputElement>(null);

  const templateUrl = `/api/flows/${flowId}/nodes/${nodeId}/template`;

  const save = useCallback(
    async (rowsToSave: EditableRow[], fileForSave: File | null) => {
      setStep("saving");
      setError(null);

      const payloadRows = toPayloadRows(rowsToSave);

      try {
        // A file present (fresh upload or re-upload) writes a new template via
        // POST; its absence means re-entry editing the stored one via PATCH.
        const response = fileForSave
          ? await (() => {
              const body = new FormData();
              body.append("file", fileForSave);
              body.append("annotations", JSON.stringify(payloadRows));
              return fetch(templateUrl, { method: "POST", body });
            })()
          : await fetch(templateUrl, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ annotations: payloadRows }),
            });

        const payload = (await response.json()) as Parameters<typeof onSaved>[0] & {
          error?: string;
        };
        if (!response.ok) {
          setError(toTemplateError(payload, "Could not save the template."));
          setStep("review");
          return;
        }

        onSaved(payload);
      } catch {
        setError(toTemplateError(null, "Could not save the template."));
        setStep("review");
      }
    },
    [onSaved, templateUrl],
  );

  const runAnalyse = useCallback(
    async (fileToAnalyse: File) => {
      setStep("analysing");
      setError(null);
      const body = new FormData();
      body.append("file", fileToAnalyse);

      try {
        const response = await fetch(`${templateUrl}/analyse`, { method: "POST", body });
        const payload = (await response.json()) as AnalyseResponse & { error?: string };
        if (!response.ok) {
          setError(toTemplateError(payload, "Could not read that document."));
          setStep("detected");
          return;
        }

        setAnalysis(payload);
        // An .xlsx already usable in ADR-039 header mode keeps today's behaviour:
        // annotating it would convert it to tag mode and change how it is filled,
        // so it is stored as-is without entering the guided flow.
        if (payload.classification === "header") {
          await save([], fileToAnalyse);
          return;
        }
        setRows(toEditableRows(payload.rows));
        setStep("detected");
      } catch {
        setError(toTemplateError(null, "Could not read that document."));
        setStep("detected");
      }
    },
    [save, templateUrl],
  );

  useEffect(() => {
    if (isReentry || analysedRef.current || !file) return;
    analysedRef.current = true;
    void runAnalyse(file);
  }, [file, isReentry, runAnalyse]);

  const updateRow = (index: number, patch: Partial<EditableRow>) => {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  // Model is the source of truth; `line` is recomputed from it so validation and
  // serialisation stay in step while the type survives even with no options yet.
  const setRowModel = (index: number, next: FieldModel) => {
    updateRow(index, { model: next, line: modelToLine(next) });
  };

  const updateModel = (index: number, patch: Partial<FieldModel>) => {
    setRows((current) =>
      current.map((row, i) => {
        if (i !== index) return row;
        const model = { ...row.model, ...patch };
        return { ...row, model, line: modelToLine(model) };
      }),
    );
  };

  const changeType = (index: number, type: FieldRowType) => {
    setRows((current) =>
      current.map((row, i) => {
        if (i !== index) return row;
        const model = withType(row.model, type);
        return { ...row, model, line: modelToLine(model) };
      }),
    );
  };

  const acceptCorrection = (index: number, line: string) => {
    updateRow(index, { line, model: lineToModel(line) });
  };

  const removeRow = (index: number) => setRowModel(index, { ...rows[index]!.model, label: "" });

  const onReupload = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.files?.[0];
    if (reuploadInputRef.current) reuploadInputRef.current.value = "";
    if (!next) return;
    setActiveFile(next);
    setAnalysis(null);
    setRows([]);
    void runAnalyse(next);
  };

  const duplicates = duplicateCounts(rows);
  const blockedReason = saveBlockedReason(rows);
  const activeConfigRow = configIndex !== null ? rows[configIndex] : null;
  const signatureOptions = signatureLabelsIn(rows);
  const foundFields = rows.filter((row) => !row.locked && row.line.trim().length > 0);
  const hasFields = foundFields.length > 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle>
            {isReentry ? "Edit template fields" : "Set up your template"}
            {analysis?.filename ? ` — ${analysis.filename}` : ""}
          </DialogTitle>
          <DialogCloseButton />
        </DialogHeader>

        <DialogBody className="min-h-0 flex-1 overflow-y-auto">
          {error && <TemplateErrorPanel error={error} />}

          {step === "analysing" && <Working message="Reading your document…" />}
          {step === "saving" && <Working message="Saving your template…" />}

          {step === "detected" && hasFields && (
            <FoundFields fields={foundFields} blockedReason={blockedReason} />
          )}
          {step === "detected" && !hasFields && (
            <NoFieldsYet onOpenReference={() => setStep("reference")} />
          )}

          {step === "reference" && <AnnotationReference />}

          {step === "reupload" && <ReuploadPanel inputRef={reuploadInputRef} onFile={onReupload} />}

          {step === "review" && (
            <div className="space-y-3">
              <p className="text-[12px] text-[#666055]">
                Check each data field, set its type, and use the cog for choices and limits. The line
                beneath each row is what goes into your document — copy it into Word any time.
              </p>

              <div className="space-y-3">
                {rows.map((row, index) => (
                  <ReviewRow
                    key={row.id}
                    row={row}
                    validation={validateRow(row, rows)}
                    index={index}
                    duplicateCount={duplicates.get(row.key.split(":")[0] ?? row.key) ?? 0}
                    onChangeModel={(patch) => updateModel(index, patch)}
                    onChangeType={(type) => changeType(index, type)}
                    onRemove={() => removeRow(index)}
                    onOpenConfig={() => setConfigIndex(index)}
                    onAcceptCorrection={(line) => acceptCorrection(index, line)}
                  />
                ))}
              </div>
            </div>
          )}
        </DialogBody>

        <DialogFooter className="flex-wrap gap-y-2">
          <div className="mr-auto flex flex-wrap items-center gap-x-3 gap-y-1">
            <Button type="button" variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
            {step === "review" && blockedReason && (
              <span className="text-[12px] text-[#666055]">{blockedReason}</span>
            )}
          </div>

          {step === "detected" && hasFields && (
            <>
              <Button type="button" variant="secondary" onClick={() => setStep("review")}>
                Edit fields
              </Button>
              <Button
                type="button"
                disabled={blockedReason !== null}
                onClick={() => void save(rows, activeFile)}
              >
                Accept these fields
              </Button>
            </>
          )}

          {step === "detected" && !hasFields && (
            <Button type="button" onClick={() => setStep("reupload")}>
              I&apos;ve added them
            </Button>
          )}

          {step === "reference" && (
            <Button type="button" onClick={() => setStep("detected")}>
              Back
            </Button>
          )}

          {step === "review" && (
            <Button
              type="button"
              disabled={blockedReason !== null}
              onClick={() => void save(rows, activeFile)}
            >
              Save template
            </Button>
          )}
        </DialogFooter>

        {activeConfigRow && configIndex !== null && (
          <FieldConfigModal
            model={activeConfigRow.model}
            onChange={(patch) => updateModel(configIndex, patch)}
            onClose={() => setConfigIndex(null)}
            signatureOptions={signatureOptions}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// A headline the author can act on, plus one row per malformed tag: the text as
// they typed it in Word, and what is wrong with it. Before v0.28.20 this was a
// single generic sentence, which in a hundred-tag template named nothing at all.
function TemplateErrorPanel({ error }: { error: TemplateError }) {
  return (
    <div className="mb-3 rounded-[9px] border border-[#f0c9d4] bg-[#f9e8eb] px-3 py-2 text-[12px] text-[#a8324c]">
      <p>{error.headline}</p>
      {error.details.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {error.details.map((detail) => (
            <li key={`${detail.subject} ${detail.message}`} className="border-l-2 border-[#e0a9b8] pl-2">
              <code className="block break-words font-mono text-[11px] text-[#7d2338]">
                {detail.subject}
              </code>
              <span className="text-[11px] text-[#a8324c]">{detail.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Working({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-[#666055]">
      <Loader2 size={16} className="animate-spin" />
      {message}
    </div>
  );
}

function FoundFields({
  fields,
  blockedReason,
}: {
  fields: EditableRow[];
  blockedReason: string | null;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="text-[14px] font-medium text-[#1c1b19]">
          {fields.length === 1 ? "1 data field found" : `${fields.length} data fields found`}
        </p>
        <p className="text-[13px] text-[#5c574c]">
          These are the placeholders in your document. Accept them as they are, or change their
          names and types first.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-x-6 gap-y-1 rounded-[9px] border border-[#ebe8e0] bg-[#faf9f7] p-3 sm:grid-cols-2">
        {fields.map((row) => (
          <div key={row.id} className="flex items-baseline gap-1.5 text-[12px]">
            <span className="text-[#2f56d3]">•</span>
            <span className="truncate text-[#1c1b19]">{row.model.label || row.line}</span>
            <span className="shrink-0 text-[#666055]">({rowTypeLabel(row)})</span>
          </div>
        ))}
      </div>

      {blockedReason && (
        <p className="rounded-[9px] border border-[#e6d9b8] bg-[#fbf6e8] px-3 py-2 text-[12px] text-[#8a6d1f]">
          One or more placeholders need attention before this can be saved. Choose Edit fields to see
          which.
        </p>
      )}
    </div>
  );
}

function NoFieldsYet({ onOpenReference }: { onOpenReference: () => void }) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="text-[14px] font-medium text-[#1c1b19]">No data fields yet</p>
        <p className="text-[13px] text-[#5c574c]">
          This document has no placeholders in it. Open it in Word and type a name in double braces
          wherever a value belongs — like this:
        </p>
      </div>

      <AnnotationTypingDemo />

      <p className="text-[12px] text-[#5c574c]">
        Every kind of field is listed in the{" "}
        <button
          type="button"
          className="font-medium text-[#2f56d3] underline hover:text-[#1f3ea8]"
          onClick={onOpenReference}
        >
          complete list of annotations
        </button>
        . Save the document, then upload it again and the fields will be picked up.
      </p>
    </div>
  );
}

function ReuploadPanel({
  inputRef,
  onFile,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFile: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-[#5c574c]">
        When you are done editing, upload the document here to pick the flow back up with your new
        data fields.
      </p>
      <button
        type="button"
        className="flex w-full flex-col items-center gap-2 rounded-[9px] border border-dashed border-[#e7e3db] bg-[#faf9f7] p-6 text-center text-[13px] text-[#666055] transition-colors hover:border-[#c3cef2] hover:bg-[#eaeefb] hover:text-[#2f56d3]"
        onClick={() => inputRef.current?.click()}
      >
        <Upload size={20} />
        Click to upload your edited .docx or .xlsx
      </button>
      <input ref={inputRef} type="file" accept=".docx,.xlsx" className="sr-only" onChange={onFile} />
    </div>
  );
}

function ReviewRow({
  row,
  validation,
  index,
  duplicateCount,
  onChangeModel,
  onChangeType,
  onRemove,
  onOpenConfig,
  onAcceptCorrection,
}: {
  row: EditableRow;
  // Computed by the parent, because a comment row's binding is only valid or
  // not against the other rows in the same template.
  validation: RowValidation;
  index: number;
  duplicateCount: number;
  onChangeModel: (patch: Partial<FieldModel>) => void;
  onChangeType: (type: FieldRowType) => void;
  onRemove: () => void;
  onOpenConfig: () => void;
  onAcceptCorrection: (line: string) => void;
}) {
  if (row.locked) {
    return (
      <div className="flex items-start gap-2 rounded-[9px] border border-[#ebe8e0] bg-[#faf9f7] px-3 py-2">
        <Lock size={13} className="mt-0.5 shrink-0 text-[#666055]" />
        <div className="min-w-0 space-y-0.5">
          <code className="block truncate font-mono text-[12px] text-[#5c574c]">
            {`{{${row.line}}}`}
          </code>
          <p className="text-[11px] text-[#666055]">
            An include/repeat block. It is kept exactly as it is — edit it in Word.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`space-y-1.5 rounded-[9px] border p-2.5 ${
        validation.blocking.length > 0 ? "border-[#f0c9d4] bg-[#fdfafb]" : "border-[#ebe8e0]"
      }`}
    >
      <FieldRow
        model={row.model}
        index={index}
        onChange={onChangeModel}
        onChangeType={onChangeType}
        onRemove={onRemove}
        onOpenConfig={onOpenConfig}
        typeOptions={TEMPLATE_TYPE_OPTIONS}
        labelPlaceholder="e.g. Supplier Name"
      />

      <code className="block truncate font-mono text-[11px] text-[#666055]">
        {row.line.trim() ? `{{ ${row.line.trim()} }}` : "— removed from the document —"}
      </code>

      {validation.blocking.map((message) => (
        <p key={message} className="flex items-start gap-1 text-[11px] text-[#a8324c]">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          {message}
        </p>
      ))}

      {validation.warnings.map((warning) => (
        <div key={warning.message} className="flex items-start gap-1 text-[11px] text-[#8a6d1f]">
          <Info size={12} className="mt-0.5 shrink-0" />
          <span>{warning.message}</span>
          <button
            type="button"
            className="shrink-0 font-medium text-[#2f56d3] hover:text-[#1f3ea8]"
            onClick={() => onAcceptCorrection(warning.correctedLine)}
          >
            Fix
          </button>
        </div>
      ))}

      {duplicateCount > 1 && (
        <p className="text-[11px] text-[#666055]">
          Asked once, fills {duplicateCount} places in the document.
        </p>
      )}
    </div>
  );
}
