"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { Upload, X } from "lucide-react";
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
import { FieldConfigModal } from "./field-row";
import { lineToModel, modelToLine, withType, type FieldModel, type FieldRowType } from "./field-row-model";
import { ReuploadPanel, TemplateErrorPanel, Working } from "./template-annotation-modal";
import { signatureLabelsIn, toEditableRows, validateRow, type EditableRow } from "./template-annotation-model";
import { TemplateDraftCompare } from "./template-draft-compare";
import type { DraftComparisonPayload } from "./template-draft-compare-model";
import {
  confirmRow,
  draftSaveBlockedReason,
  exampleProblems,
  restoreRow,
  type DraftStep,
} from "./template-draft-model";
import {
  AddMoreFieldsBlock,
  DraftedFieldsSummary,
  DraftReviewRow,
  NotPlacedList,
  SameInEveryExampleList,
  type UnplacedValue,
} from "./template-draft-review";
import { toTemplateError, type TemplateError } from "./template-error-model";
import type { TemplateUploadResult } from "./template-upload-controller";

interface DraftResponse {
  filename: string;
  exampleCount: number;
  rows: AnnotationRow[];
  sameInEveryExample: AnnotationRow[];
  unplaced: UnplacedValue[];
  comparison: DraftComparisonPayload;
  taggedDocument: string;
}

// One request does all three stages, so these are a progress cue rather than a
// report of which stage the server is on.
const DRAFTING_MESSAGES = ["Reading examples…", "Drafting fields…", "Checking for anything missed…"];
const DRAFTING_MESSAGE_INTERVAL_MS = 4000;

const toPayloadRows = (rows: EditableRow[]): AnnotationRow[] =>
  rows.map(({ id, model, ...row }) => {
    void id;
    void model;
    return row;
  });

const downloadBase64 = (base64: string, filename: string) => {
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes]));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

// The draft-from-examples path (ADR-067): pick filled examples, draft, review,
// compare side by side, save. Examples stay in the browser; the save posts the
// base example with the reviewed rows to the existing template route, which
// writes the placeholders into it there.
export function TemplateDraftModal({
  flowId,
  nodeId,
  onCancel,
  onSaved,
  onSwitchToTagged,
}: {
  flowId: string;
  nodeId: string;
  onCancel: () => void;
  onSaved: (result: TemplateUploadResult) => void;
  onSwitchToTagged: (file: File) => void;
}) {
  const [step, setStep] = useState<DraftStep>("choose-examples");
  const [files, setFiles] = useState<File[]>([]);
  const [baseIndex, setBaseIndex] = useState(0);
  const [draft, setDraft] = useState<DraftResponse | null>(null);
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [sameInEveryExample, setSameInEveryExample] = useState<EditableRow[]>([]);
  const [error, setError] = useState<TemplateError | null>(null);
  const [draftFailed, setDraftFailed] = useState(false);
  const [configIndex, setConfigIndex] = useState<number | null>(null);
  const [messageIndex, setMessageIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const reuploadInputRef = useRef<HTMLInputElement>(null);

  const templateUrl = `/api/flows/${flowId}/nodes/${nodeId}/template`;
  const problems = exampleProblems(files);
  const blockedReason = draftSaveBlockedReason(rows);

  useEffect(() => {
    if (step !== "drafting") return;
    setMessageIndex(0);
    const timer = setInterval(
      () => setMessageIndex((current) => Math.min(current + 1, DRAFTING_MESSAGES.length - 1)),
      DRAFTING_MESSAGE_INTERVAL_MS,
    );
    return () => clearInterval(timer);
  }, [step]);

  const onPickFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? []);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setFiles((current) => [...current, ...picked]);
    setError(null);
  };

  const removeFile = (index: number) => {
    setFiles((current) => current.filter((_, i) => i !== index));
    setBaseIndex((current) => (index < current ? current - 1 : index === current ? 0 : current));
  };

  const runDraft = useCallback(async () => {
    setStep("drafting");
    setError(null);
    setDraftFailed(false);
    const body = new FormData();
    for (const file of files) body.append("files", file);
    body.append("baseIndex", String(baseIndex));

    try {
      const response = await fetch(`${templateUrl}/draft`, { method: "POST", body });
      const payload = (await response.json()) as DraftResponse & { error?: string };
      if (!response.ok) {
        setError(toTemplateError(payload, "Couldn't draft fields from these examples."));
        setDraftFailed(response.status >= 500);
        setStep("choose-examples");
        return;
      }
      setDraft(payload);
      setRows(toEditableRows(payload.rows));
      setSameInEveryExample(
        toEditableRows(payload.sameInEveryExample).map((row) => ({ ...row, id: `same-${row.id}` })),
      );
      setStep("review");
    } catch {
      setError(toTemplateError(null, "Couldn't draft fields from these examples."));
      setDraftFailed(true);
      setStep("choose-examples");
    }
  }, [baseIndex, files, templateUrl]);

  const save = async () => {
    const baseFile = files[baseIndex];
    if (!baseFile) return;
    setStep("saving");
    setError(null);
    const body = new FormData();
    body.append("file", baseFile);
    body.append("annotations", JSON.stringify(toPayloadRows(rows)));

    try {
      const response = await fetch(templateUrl, { method: "POST", body });
      const payload = (await response.json()) as TemplateUploadResult & { error?: string };
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
    setRows((current) => current.map((row, i) => (i === index ? { ...row, line, model: lineToModel(line) } : row)));
  };

  const restore = (id: string) => {
    const result = restoreRow(rows, sameInEveryExample, id);
    setRows(result.rows);
    setSameInEveryExample(result.sameInEveryExample);
  };

  const downloadDraft = () => {
    if (!draft) return;
    downloadBase64(draft.taggedDocument, draft.filename.replace(/\.docx$/i, "") + "-draft.docx");
    setStep("reupload");
  };

  const onReupload = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.files?.[0];
    if (reuploadInputRef.current) reuploadInputRef.current.value = "";
    if (next) onSwitchToTagged(next);
  };

  const activeConfigRow = configIndex !== null ? rows[configIndex] : null;
  const hasDraftedFields = rows.length > 0 || sameInEveryExample.length > 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="flex max-h-[85vh] max-w-4xl flex-col">
        <DialogHeader>
          <DialogTitle>
            Draft a template from examples{draft?.filename ? ` — ${draft.filename}` : ""}
          </DialogTitle>
          <DialogCloseButton />
        </DialogHeader>

        <DialogBody className="min-h-0 flex-1 overflow-y-auto">
          {error && <TemplateErrorPanel error={error} />}

          {step === "choose-examples" && (
            <ChooseExamples
              files={files}
              baseIndex={baseIndex}
              problems={problems}
              inputRef={fileInputRef}
              onPick={onPickFiles}
              onRemove={removeFile}
              onChooseBase={setBaseIndex}
            />
          )}

          {step === "drafting" && <Working message={DRAFTING_MESSAGES[messageIndex]!} />}
          {step === "saving" && <Working message="Saving your template…" />}
          {step === "reference" && <AnnotationReference />}
          {step === "reupload" && <ReuploadPanel inputRef={reuploadInputRef} onFile={onReupload} />}

          {step === "review" && draft && !hasDraftedFields && (
            <div className="space-y-1">
              <p className="text-[14px] font-medium text-[#1c1b19]">No data fields found</p>
              <p className="text-[13px] text-[#5c574c]">
                Nothing in these examples looked like a value that changes. You can tag the document yourself in Word
                instead.
              </p>
            </div>
          )}

          {step === "review" && draft && hasDraftedFields && (
            <div className="space-y-3">
              <DraftedFieldsSummary rows={rows} exampleCount={draft.exampleCount} />
              <div className="space-y-3">
                {rows.map((row, index) => (
                  <DraftReviewRow
                    key={row.id}
                    row={row}
                    index={index}
                    validation={validateRow(row, rows)}
                    onChangeModel={(patch) => updateModel(index, patch)}
                    onChangeType={(type) => changeType(index, type)}
                    onRemove={() => updateModel(index, { label: "" })}
                    onOpenConfig={() => setConfigIndex(index)}
                    onAcceptCorrection={(line) => acceptCorrection(index, line)}
                    onConfirm={() => setRows((current) => confirmRow(current, row.id))}
                  />
                ))}
              </div>
              <NotPlacedList values={draft.unplaced} />
              <SameInEveryExampleList rows={sameInEveryExample} onRestore={restore} />
              <AddMoreFieldsBlock onDownload={downloadDraft} />
            </div>
          )}

          {step === "compare" && draft && <TemplateDraftCompare comparison={draft.comparison} />}
        </DialogBody>

        <DialogFooter className="flex-wrap gap-y-2">
          <div className="mr-auto flex flex-wrap items-center gap-x-3 gap-y-1">
            <Button type="button" variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
            {step === "review" && hasDraftedFields && blockedReason && (
              <span className="text-[12px] text-[#666055]">{blockedReason}</span>
            )}
          </div>

          {step === "choose-examples" && draftFailed && (
            <Button type="button" variant="secondary" onClick={() => setStep("reference")}>
              Tag it myself
            </Button>
          )}
          {step === "choose-examples" && (
            <Button type="button" disabled={files.length === 0 || problems.length > 0} onClick={() => void runDraft()}>
              {draftFailed ? "Retry" : "Draft template"}
            </Button>
          )}

          {step === "reference" && (
            <Button type="button" onClick={() => setStep(draft ? "review" : "choose-examples")}>
              Back
            </Button>
          )}

          {step === "review" && !hasDraftedFields && (
            <Button type="button" onClick={() => setStep("reference")}>
              Tag it myself
            </Button>
          )}
          {step === "review" && hasDraftedFields && (
            <Button type="button" disabled={blockedReason !== null} onClick={() => setStep("compare")}>
              Compare and save
            </Button>
          )}

          {step === "compare" && (
            <>
              <Button type="button" variant="secondary" onClick={() => setStep("review")}>
                Back
              </Button>
              <Button type="button" onClick={() => void save()}>
                Save template
              </Button>
            </>
          )}
        </DialogFooter>

        {activeConfigRow && configIndex !== null && (
          <FieldConfigModal
            model={activeConfigRow.model}
            onChange={(patch) => updateModel(configIndex, patch)}
            onClose={() => setConfigIndex(null)}
            signatureOptions={signatureLabelsIn(rows)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ChooseExamples({
  files,
  baseIndex,
  problems,
  inputRef,
  onPick,
  onRemove,
  onChooseBase,
}: {
  files: File[];
  baseIndex: number;
  problems: { subject: string; message: string }[];
  inputRef: React.RefObject<HTMLInputElement | null>;
  onPick: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemove: (index: number) => void;
  onChooseBase: (index: number) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-[#5c574c]">
        Add one or more completed copies of the same document, up to 10. More examples make a better draft: text that
        changes between them becomes a field. The base example is the one the template is made from.
      </p>

      <button
        type="button"
        className="flex w-full flex-col items-center gap-2 rounded-[9px] border border-dashed border-[#e7e3db] bg-[#faf9f7] p-6 text-center text-[13px] text-[#666055] transition-colors hover:border-wf-primary-dim hover:bg-wf-primary-light hover:text-wf-primary"
        onClick={() => inputRef.current?.click()}
      >
        <Upload size={20} />
        Click to add Word (.docx) examples
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".docx"
        multiple
        className="sr-only"
        aria-label="Add example documents"
        onChange={onPick}
      />

      {files.length > 0 && (
        <fieldset className="space-y-1">
          <legend className="mb-1 text-[12px] font-medium text-[#1c1b19]">Base example</legend>
          {files.map((file, index) => (
            <div key={`${file.name}-${index}`} className="flex items-center gap-2 text-[12px] text-[#1c1b19]">
              <input
                type="radio"
                name="base-example"
                id={`base-example-${index}`}
                checked={baseIndex === index}
                onChange={() => onChooseBase(index)}
              />
              <label htmlFor={`base-example-${index}`} className="min-w-0 flex-1 truncate">
                {file.name}
              </label>
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                className="text-[#666055] hover:text-[#a8324c]"
                onClick={() => onRemove(index)}
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </fieldset>
      )}

      {problems.length > 0 && (
        <ul className="space-y-1 rounded-[9px] border border-[#f0c9d4] bg-[#f9e8eb] px-3 py-2 text-[12px] text-[#a8324c]">
          {problems.map((problem) => (
            <li key={`${problem.subject} ${problem.message}`}>
              <span className="font-medium">{problem.subject}</span> — {problem.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
