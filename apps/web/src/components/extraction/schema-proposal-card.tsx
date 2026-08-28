"use client";

import { useState } from "react";
import type {
  ExtractionFieldDraft,
  ExtractionInputConfig,
  ExtractionOutputConfig,
  SchemaProposal,
  SchemaProposalFinding,
} from "@rbrasier/domain";
import { trpc } from "@/trpc/client";
import { readFileAsBase64 } from "@/lib/read-file-base64";
import { SchemaProposalPanel } from "./schema-proposal-panel";

interface ProposalView {
  proposal: SchemaProposal;
  fields: ExtractionFieldDraft[];
  findings: SchemaProposalFinding[];
}

interface SampleDocument {
  filename: string;
  treePath: string;
  mimeType: string;
  contentBase64: string;
}

export interface SchemaProposalCardProps {
  flowId: string;
  input: ExtractionInputConfig;
  output: ExtractionOutputConfig;
  // Called with the confirmed drafts so the editor shows what was written. The
  // schema itself is already saved by the time this fires — confirmation is the
  // single write (ADR-052).
  onConfirmed: (fields: ExtractionFieldDraft[]) => void;
}

// The AI schema-proposal interaction, kept in its own component: the proposal is
// thread-local state that lives entirely in this component's `useState` and in
// the request bodies it sends. Nothing about it is stored server-side, and when
// the author navigates away it is gone — which is the whole design (ADR-052 §1).
export function SchemaProposalCard({
  flowId,
  input,
  output,
  onConfirmed,
}: SchemaProposalCardProps) {
  const [intent, setIntent] = useState("");
  const [instruction, setInstruction] = useState("");
  const [documents, setDocuments] = useState<SampleDocument[]>([]);
  const [view, setView] = useState<ProposalView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const utils = trpc.useUtils();

  const failWith = (message: string) => setError(message);

  const proposeMutation = trpc.extraction.proposeSchema.useMutation({
    onSuccess: (data) => {
      setError(null);
      setView(data);
    },
    onError: (mutationError) => failWith(mutationError.message),
  });

  const refineMutation = trpc.extraction.refineSchema.useMutation({
    onSuccess: (data) => {
      setError(null);
      setInstruction("");
      setView(data);
    },
    onError: (mutationError) => failWith(mutationError.message),
  });

  const confirmMutation = trpc.extraction.confirmSchema.useMutation({
    onSuccess: (data) => {
      setError(null);
      const confirmed = view;
      setView(confirmed ? { ...confirmed, proposal: data.proposal } : null);
      if (confirmed) onConfirmed(confirmed.fields);
      // Confirmation writes the schema draft, exactly as Save does, so the
      // cached schema is stale from here. Without this a later refetch flips the
      // editor's seed key and remounts it, discarding edits made since.
      void utils.extraction.getSchema.invalidate({ flowId });
    },
    onError: (mutationError) => failWith(mutationError.message),
  });

  const busy = proposeMutation.isPending || refineMutation.isPending || confirmMutation.isPending;

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
    setDocuments(picked);
  };

  const context = { flowId, intent: intent.trim(), documents };

  return (
    <div className="flex flex-col gap-[10px] rounded-[10px] border border-[#e7e3db] bg-[#faf9f6] p-[12px]">
      <p className="text-[12px] text-[#6d6a63]">
        Describe what you need to capture and the AI will draft the fields. Nothing is saved until
        you confirm, and the draft is lost if you leave this page.
      </p>

      <textarea
        value={intent}
        onChange={(event) => setIntent(event.target.value)}
        rows={2}
        placeholder="e.g. Compare supplier bids on price, delivery date and warranty terms"
        className="rounded-[8px] border border-[#e7e3db] px-[10px] py-[7px] text-[13px]"
      />

      <label className="flex items-center gap-[8px] text-[12px] text-[#6d6a63]">
        <input
          type="file"
          multiple
          className="text-[12px]"
          onChange={(event) => void handleSamples(event.target.files)}
        />
        {documents.length > 0 ? `${documents.length} sample(s) attached` : "Optional sample documents"}
      </label>

      <div className="flex items-center gap-[8px]">
        <button
          type="button"
          disabled={busy || intent.trim().length === 0}
          onClick={() => proposeMutation.mutate(context)}
          className="rounded-[8px] bg-[#1f1d1a] px-[12px] py-[7px] text-[13px] font-medium text-white disabled:opacity-50"
        >
          {proposeMutation.isPending ? "Drafting…" : view ? "Start over" : "Draft fields with AI"}
        </button>
      </div>

      {error ? (
        /* Beside the controls that produced it, not in a page-level line: a
           proposal failure is local to this exchange. */
        <p className="rounded-[8px] border border-[#e9c8c4] bg-[#fdf2f1] px-[10px] py-[8px] text-[12px] text-[#8c3a32]">
          {error}
        </p>
      ) : null}

      {view ? (
        <>
          <SchemaProposalPanel
            proposal={view.proposal}
            fields={view.fields}
            findings={view.findings}
            busy={busy}
            onConfirm={() =>
              confirmMutation.mutate({ flowId, proposal: view.proposal, input, output })
            }
          />

          {view.proposal.status === "draft" ? (
            <div className="flex items-center gap-[8px]">
              <input
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                placeholder="What should change? e.g. add the warranty period"
                className="flex-1 rounded-[8px] border border-[#e7e3db] px-[10px] py-[7px] text-[13px]"
              />
              <button
                type="button"
                disabled={busy || instruction.trim().length === 0}
                onClick={() =>
                  refineMutation.mutate({
                    ...context,
                    proposal: view.proposal,
                    instruction: instruction.trim(),
                  })
                }
                className="rounded-[8px] border border-[#e7e3db] px-[12px] py-[7px] text-[13px] disabled:opacity-50"
              >
                {refineMutation.isPending ? "Refining…" : "Refine"}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
