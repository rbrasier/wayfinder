"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { isTerminalRun, type RunStatus } from "@rbrasier/domain";
import { Button } from "@/components/ui/button";
import { trpc } from "@/trpc/client";
import { ResultGrid, type SampleResult } from "./result-grid";
import { SummaryPreview } from "./summary-preview";
import { RunReport } from "./run-report";

// The finished review surface for a run (phase §4): files + records with source
// highlighting, audited per-field editing, the exceptions filter, the summary
// rendered above the rows, downloads, and the refine / continue / mark-complete
// controls. All server-side gated; the buttons only reflect what the run allows.
export interface RunResultsProps {
  flowId: string;
  runId: string;
}

const artifactHref = (runId: string, artifact: string): string =>
  `/api/synthesise/runs/${runId}/artifacts/${artifact}`;

export function RunResults({ flowId, runId }: RunResultsProps) {
  const utils = trpc.useUtils();
  const resultsQuery = trpc.extraction.getResults.useQuery({ runId });
  const summaryQuery = trpc.extraction.summaryMarkdown.useQuery({ runId });
  const [generated, setGenerated] = useState(false);
  const [exported, setExported] = useState(false);

  const refresh = () => {
    void utils.extraction.getResults.invalidate({ runId });
    void utils.extraction.runReport.invalidate({ runId });
  };

  const editMutation = trpc.extraction.editResult.useMutation({
    onSuccess: () => {
      toast.success("Correction saved");
      refresh();
    },
    onError: (error) => toast.error(error.message),
  });
  const continueMutation = trpc.extraction.continue.useMutation({
    onSuccess: refresh,
    onError: (error) => toast.error(error.message),
  });
  const markCompleteMutation = trpc.extraction.markComplete.useMutation({
    onSuccess: () => {
      toast.success("Run marked complete");
      refresh();
    },
    onError: (error) => toast.error(error.message),
  });
  const generateMutation = trpc.extraction.generateDocuments.useMutation({
    onSuccess: () => {
      setGenerated(true);
      toast.success("Documents generated");
    },
    onError: (error) => toast.error(error.message),
  });
  const exportMutation = trpc.extraction.export.useMutation({
    onSuccess: () => {
      setExported(true);
      toast.success("Export ready");
    },
    onError: (error) => toast.error(error.message),
  });

  if (resultsQuery.isLoading) {
    return <p className="text-[13px] text-[#8a857c]">Loading results…</p>;
  }
  if (resultsQuery.error) {
    return <p className="text-[13px] text-[#b23b30]">{resultsQuery.error.message}</p>;
  }

  const data = resultsQuery.data!;
  const status = data.run.status as RunStatus;
  const isPaused = status === "paused_preview" || status === "paused_cap";

  const result: SampleResult = {
    documents: data.documents.map((document) => ({
      id: document.id,
      filename: document.filename,
      treePath: document.treePath,
      readable: document.readable,
    })),
    records: data.records.map((record) => ({
      id: record.id,
      label: record.label,
      fields: record.fields,
      sourceDocumentIds: record.sourceDocumentIds,
    })),
    exceptionFileIds: data.exceptionFileIds,
  };

  const summaryMarkdown = summaryQuery.data?.markdown ?? null;

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex flex-wrap items-center justify-between gap-[10px]">
        <div className="flex flex-wrap gap-[8px]">
          <Button
            type="button"
            variant="outline"
            disabled={generateMutation.isPending}
            onClick={() => generateMutation.mutate({ runId })}
          >
            {generateMutation.isPending ? "Generating…" : "Generate documents"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={exportMutation.isPending}
            onClick={() => exportMutation.mutate({ runId })}
          >
            {exportMutation.isPending ? "Exporting…" : "Download data"}
          </Button>
          {generated ? (
            <>
              <Button asChild variant="ghost">
                <a href={artifactHref(runId, "document")}>Document</a>
              </Button>
              <Button asChild variant="ghost">
                <a href={artifactHref(runId, "summary-doc")}>Summary doc</a>
              </Button>
            </>
          ) : null}
          {exported ? (
            <>
              <Button asChild variant="ghost">
                <a href={artifactHref(runId, "export-xlsx")}>XLSX</a>
              </Button>
              <Button asChild variant="ghost">
                <a href={artifactHref(runId, "export-json")}>JSON</a>
              </Button>
            </>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-[8px]">
          <Button asChild variant="outline">
            <Link href={`/synthesise/${flowId}/edit`}>Refine input</Link>
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!isPaused || continueMutation.isPending}
            onClick={() => continueMutation.mutate({ runId })}
          >
            Continue processing
          </Button>
          <Button
            type="button"
            disabled={isTerminalRun(data.run) || markCompleteMutation.isPending}
            onClick={() => markCompleteMutation.mutate({ runId })}
          >
            Mark complete
          </Button>
        </div>
      </div>

      {summaryMarkdown ? (
        <SummaryPreview markdown={summaryMarkdown} downloadHref={artifactHref(runId, "summary-doc")} />
      ) : null}

      <ResultGrid
        result={result}
        options={{
          showFilters: true,
          editing: true,
          documentHref: (documentId) => `/api/synthesise/documents/${documentId}`,
          onEditField: (recordId, fieldKey, newValue) =>
            editMutation.mutate({ runId, recordId, fieldKey, newValue }),
        }}
      />

      <RunReport runId={runId} />
    </div>
  );
}
