"use client";

import { useState, type ReactNode } from "react";
import { Loader2, PencilLine, Sparkles, Upload, X } from "lucide-react";
import type {
  ExtractionFieldDraft,
  ExtractionInputConfig,
  ExtractionOutputConfig,
  SchemaProposal,
  SchemaProposalFinding,
} from "@rbrasier/domain";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/trpc/client";
import { readFileAsBase64 } from "@/lib/read-file-base64";
import { SchemaProposalPanel } from "./schema-proposal-panel";
import { draftState } from "./schema-proposal-model";

interface ProposalView {
  proposal: SchemaProposal;
  fields: ExtractionFieldDraft[];
  outputInstruction: string;
  findings: SchemaProposalFinding[];
}

interface SampleDocument {
  filename: string;
  treePath: string;
  mimeType: string;
  contentBase64: string;
}

// Which of the overlay's four faces is showing. `choice` is the fork the author
// lands on; `form` gathers the sample and any instructions; `review` shows what
// came back. Drafting is a face of its own rather than a spinner on the form,
// because a schema proposal is a long call and a frozen form reads as a hang.
type Step = "choice" | "form" | "review";

export interface SchemaGeneratorOverlayProps {
  flowId: string;
  input: ExtractionInputConfig;
  output: ExtractionOutputConfig;
  // The author chose to configure the fields by hand. Nothing is drafted and
  // nothing is written — the overlay simply gets out of the way.
  onConfigureManually: () => void;
  // Called with the confirmed drafts and the output instructions drafted
  // alongside them, so the editor shows what was written. The schema itself is
  // already saved by the time this fires — confirmation is the single write
  // (ADR-052).
  onConfirmed: (fields: ExtractionFieldDraft[], outputInstruction: string) => void;
}

// The AI schema-proposal interaction, as a full-panel overlay over the output
// card. The proposal is thread-local state that lives entirely in this
// component's `useState` and in the request bodies it sends. Nothing about it is
// stored server-side, and when the author navigates away it is gone — which is
// the whole design (ADR-052 §1).
export function SchemaGeneratorOverlay({
  flowId,
  input,
  output,
  onConfigureManually,
  onConfirmed,
}: SchemaGeneratorOverlayProps) {
  const [step, setStep] = useState<Step>("choice");
  const [intent, setIntent] = useState("");
  const [documents, setDocuments] = useState<SampleDocument[]>([]);
  const [view, setView] = useState<ProposalView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const utils = trpc.useUtils();

  const failWith = (message: string) => setError(message);

  const proposeMutation = trpc.extraction.proposeSchema.useMutation({
    onSuccess: (data) => {
      setError(null);
      setView(data);
      setStep("review");
    },
    onError: (mutationError) => {
      failWith(mutationError.message);
      setStep("form");
    },
  });

  const refineMutation = trpc.extraction.refineSchema.useMutation({
    onSuccess: (data) => {
      setError(null);
      setView(data);
    },
    onError: (mutationError) => failWith(mutationError.message),
  });

  const confirmMutation = trpc.extraction.confirmSchema.useMutation({
    onSuccess: () => {
      setError(null);
      if (view) onConfirmed(view.fields, view.outputInstruction);
      // Confirmation writes the schema draft, exactly as Save does, so the
      // cached schema is stale from here. Without this a later refetch flips the
      // editor's seed key and remounts it, discarding edits made since.
      void utils.extraction.getSchema.invalidate({ flowId });
    },
    onError: (mutationError) => failWith(mutationError.message),
  });

  const drafting = proposeMutation.isPending;
  const busy = drafting || refineMutation.isPending || confirmMutation.isPending;

  const handleSamples = async (fileList: FileList | null): Promise<void> => {
    if (!fileList) return;
    const picked: SampleDocument[] = [];
    for (const file of Array.from(fileList)) {
      picked.push({
        filename: file.name,
        treePath: file.name,
        mimeType: file.type || "application/octet-stream",
        contentBase64: await readFileAsBase64(file),
      });
    }
    setDocuments((current) => [...current, ...picked]);
    setError(null);
  };

  const context = { flowId, intent: intent.trim(), documents };

  const errorLine = error ? (
    /* Beside the controls that produced it, not in a page-level line: a proposal
       failure is local to this exchange. */
    <p className="rounded-[9px] border border-[#f3ccd6] bg-[#f9e8eb] px-3 py-2 text-[12px] text-[#a8324c]">
      {error}
    </p>
  ) : null;

  return (
    <div className="absolute inset-0 z-30 flex flex-col overflow-hidden rounded-[14px] border border-[#c3cef2] bg-white">
      <div className="flex-1 overflow-y-auto p-5">
        {step === "choice" && (
          <ChoiceStep
            onGenerate={() => setStep("form")}
            onConfigureManually={onConfigureManually}
          />
        )}

        {step === "form" && !drafting && (
          <FormStep
            intent={intent}
            documents={documents}
            errorLine={errorLine}
            onIntentChange={setIntent}
            onAddSamples={handleSamples}
            onRemoveSample={(filename) =>
              setDocuments((current) => current.filter((entry) => entry.filename !== filename))
            }
            onBack={() => setStep("choice")}
            onDraft={() => proposeMutation.mutate(context)}
          />
        )}

        {drafting && <DraftingStep />}

        {step === "review" && !drafting && view && (
          <>
            {errorLine}
            <SchemaProposalPanel
              proposal={view.proposal}
              fields={view.fields}
              outputInstruction={view.outputInstruction}
              findings={view.findings}
              busy={busy}
              refining={refineMutation.isPending}
              onRefine={(instruction) =>
                refineMutation.mutate({ ...context, proposal: view.proposal, instruction })
              }
              onBack={() => setStep("form")}
              onContinue={() =>
                confirmMutation.mutate({
                  flowId,
                  proposal: view.proposal,
                  input,
                  // The drafted output instructions are part of what the author
                  // is confirming, so they go in the one write rather than
                  // waiting for a later Save the author may never make.
                  output: { ...output, instruction: view.outputInstruction || output.instruction },
                })
              }
            />
          </>
        )}
      </div>
    </div>
  );
}

// The fork the author lands on the first time the output card opens. Two ways to
// define a schema, stated as two choices rather than one path with the other
// buried in it.
function ChoiceStep({
  onGenerate,
  onConfigureManually,
}: {
  onGenerate: () => void;
  onConfigureManually: () => void;
}) {
  return (
    <div className="mx-auto flex h-full max-w-[440px] flex-col justify-center gap-3 py-6">
      <div className="space-y-1 text-center">
        <h3 className="text-[15px] font-semibold text-[#1c1b19]">How do you want to start?</h3>
        <p className="text-[12px] text-[#666055]">
          You can change everything afterwards either way.
        </p>
      </div>

      <button
        type="button"
        onClick={onGenerate}
        className="flex items-start gap-3 rounded-[10px] border border-[#c3cef2] bg-[#eaeefb] px-4 py-3.5 text-left transition-colors hover:border-[#2f56d3] hover:bg-[#e0e7fa]"
      >
        <Sparkles className="mt-0.5 h-[18px] w-[18px] shrink-0 text-[#2f56d3]" />
        <span className="space-y-0.5">
          <span className="block text-[13px] font-semibold text-[#1c1b19]">
            Build from an existing output document or sample
          </span>
          <span className="block text-[12px] text-[#5c574c]">
            Upload something you already produce and the AI drafts the fields and output
            instructions from it.
          </span>
        </span>
      </button>

      <button
        type="button"
        onClick={onConfigureManually}
        className="flex items-start gap-3 rounded-[10px] border border-[#e7e3db] bg-white px-4 py-3.5 text-left transition-colors hover:bg-[#f5f3ee]"
      >
        <PencilLine className="mt-0.5 h-[18px] w-[18px] shrink-0 text-[#666055]" />
        <span className="space-y-0.5">
          <span className="block text-[13px] font-semibold text-[#1c1b19]">Configure manually</span>
          <span className="block text-[12px] text-[#5c574c]">
            Add each field yourself, one at a time.
          </span>
        </span>
      </button>
    </div>
  );
}

function FormStep({
  intent,
  documents,
  errorLine,
  onIntentChange,
  onAddSamples,
  onRemoveSample,
  onBack,
  onDraft,
}: {
  intent: string;
  documents: SampleDocument[];
  errorLine: ReactNode;
  onIntentChange: (intent: string) => void;
  onAddSamples: (files: FileList | null) => Promise<void>;
  onRemoveSample: (filename: string) => void;
  onBack: () => void;
  onDraft: () => void;
}) {
  const draft = draftState(intent, documents.length, false);

  return (
    <div className="mx-auto max-w-[520px] space-y-4 py-2">
      <div className="space-y-1">
        <h3 className="text-[15px] font-semibold text-[#1c1b19]">
          Build from an existing output document or sample
        </h3>
        <p className="text-[12px] text-[#666055]">
          Nothing is saved until you continue, and the draft is lost if you leave this page.
        </p>
      </div>

      <div>
        <label
          htmlFor="schema-sample-upload"
          className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[10px] border-2 border-dashed border-[#c3cef2] bg-[#eaeefb] px-3 py-7 text-center transition-colors hover:border-[#2f56d3] hover:bg-[#e0e7fa]"
        >
          <Upload className="h-5 w-5 text-[#2f56d3]" />
          <span className="text-[13px] font-semibold text-[#1c1b19]">
            Upload an output document or sample
          </span>
          <span className="text-[11px] text-[#666055]">
            A spreadsheet, report or filled-in form you already produce.
          </span>
          <input
            id="schema-sample-upload"
            type="file"
            multiple
            className="sr-only"
            onChange={(event) => {
              void onAddSamples(event.target.files);
              event.target.value = "";
            }}
          />
        </label>

        {documents.length > 0 && (
          <ul className="mt-1.5 space-y-1">
            {documents.map((document) => (
              <li
                key={document.filename}
                className="flex items-center gap-2 rounded-[9px] border border-[#e7e3db] bg-[#faf9f6] px-3 py-2"
              >
                <span className="flex-1 truncate text-[12px] text-[#5c574c]">
                  {document.filename}
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${document.filename}`}
                  className="shrink-0 rounded-md p-1 text-[#666055] transition-colors hover:bg-[#f5f3ee] hover:text-[#a8324c]"
                  onClick={() => onRemoveSample(document.filename)}
                >
                  <X size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="schema-intent">Instructions (optional)</Label>
        <Textarea
          id="schema-intent"
          value={intent}
          onChange={(event) => onIntentChange(event.target.value)}
          rows={3}
          placeholder="e.g. Compare supplier bids on price, delivery date and warranty terms"
        />
      </div>

      {errorLine}

      <div className="flex items-center justify-end gap-2">
        {draft.reason && <span className="mr-auto text-[12px] text-[#666055]">{draft.reason}</span>}
        <Button type="button" variant="secondary" onClick={onBack}>
          Back
        </Button>
        <Button type="button" onClick={onDraft} disabled={draft.disabled}>
          Draft fields with AI
        </Button>
      </div>
    </div>
  );
}

function DraftingStep() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2.5 py-10 text-center">
      <Loader2 className="h-6 w-6 animate-spin text-[#2f56d3]" aria-hidden="true" />
      <p className="text-[13px] font-medium text-[#1c1b19]">Drafting your fields…</p>
      <p className="max-w-[320px] text-[12px] text-[#666055]">
        Reading the sample and working out what each record should capture. This takes a few
        seconds.
      </p>
    </div>
  );
}
