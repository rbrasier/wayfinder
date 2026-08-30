"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { isTerminalRun, type RunStatus } from "@rbrasier/domain";
import { Button } from "@/components/ui/button";
import { trpc } from "@/trpc/client";
import { RunProgress, RUN_POLL_INTERVAL_MS } from "./run-progress";
import { ResultGrid, type SampleResult } from "./result-grid";
import { SummaryPreview } from "./summary-preview";
import { RunReport } from "./run-report";
import { isLiveRun } from "./run-tick-state";
import { EXPORT_MENU_FORMATS, exportArtifact, exportLabel, type ExportFormat } from "./export-format";

// The finished review surface for a run (phase §4): the run header with its
// downloads, live progress, the summary, records with confidence and source
// drill-in, audited per-field editing, and the refine / continue / mark-complete
// controls. All server-side gated; the buttons only reflect what the run allows.
export interface RunResultsProps {
  flowId: string;
  runId: string;
}

const artifactHref = (runId: string, artifact: string): string =>
  `/api/synthesise/runs/${runId}/artifacts/${artifact}`;

export function RunResults({ flowId, runId }: RunResultsProps) {
  const utils = trpc.useUtils();
  // The worker settles documents in the background, so every panel on this
  // screen re-reads itself while the run is live — without it the table only
  // caught up when the operator reloaded the page.
  const resultsQuery = trpc.extraction.getResults.useQuery(
    { runId },
    {
      refetchInterval: (query) =>
        isLiveRun(query.state.data?.run.status) ? RUN_POLL_INTERVAL_MS : false,
    },
  );
  const live = isLiveRun(resultsQuery.data?.run.status);
  const summaryQuery = trpc.extraction.summaryMarkdown.useQuery(
    { runId },
    { refetchInterval: live ? RUN_POLL_INTERVAL_MS : false },
  );
  const [generated, setGenerated] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Which format the operator asked for, so the artifact fetched on success
  // matches the button they pressed and only that control shows as busy.
  const [downloading, setDownloading] = useState<ExportFormat | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

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
      void utils.extraction.summaryMarkdown.invalidate({ runId });
      toast.success("Documents generated");
    },
    onError: (error) => toast.error(error.message),
  });
  // The export writes the artifacts to storage; the browser then fetches the one
  // the operator asked for. Going straight to the artifact URL without exporting
  // first would serve a stale file (or a 410 on a run never exported).
  const exportMutation = trpc.extraction.export.useMutation({
    onSuccess: (_data, _variables, _context) => {
      const format = downloading;
      setDownloading(null);
      if (!format) return;
      window.location.href = artifactHref(runId, exportArtifact(format));
    },
    onError: (error) => {
      setDownloading(null);
      toast.error(error.message);
    },
  });

  const startDownload = (format: ExportFormat) => {
    setMenuOpen(false);
    setDownloading(format);
    exportMutation.mutate({ runId });
  };

  const data = resultsQuery.data ?? null;
  const status = data ? (data.run.status as RunStatus) : null;
  const isPaused = status === "paused_preview" || status === "paused_cap";

  const result: SampleResult | null = data
    ? {
        documents: data.documents.map((document) => ({
          id: document.id,
          filename: document.filename,
          treePath: document.treePath,
          readable: document.readable,
          status: document.status,
        })),
        records: data.records.map((record) => ({
          id: record.id,
          label: record.label,
          fields: record.fields,
          sourceDocumentIds: record.sourceDocumentIds,
        })),
        exceptionFileIds: data.exceptionFileIds,
      }
    : null;

  const summaryMarkdown = summaryQuery.data?.markdown ?? null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-[#e7e3db] bg-white pl-5 pr-[52px]">
        <div className="flex items-center gap-2">
          <Link
            href={`/synthesise/${flowId}/edit`}
            aria-label="Back to edit the flow"
            className="flex h-7 w-7 items-center justify-center rounded-[7px] text-[#666055] transition-colors hover:bg-[#f5f3ee] hover:text-[#1c1b19]"
          >
            <ChevronLeft size={16} />
          </Link>
          <h1 className="text-[16px] font-bold tracking-[-0.3px] text-[#1c1b19]">Summary of outputs</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={downloading !== null}
            onClick={() => startDownload("xlsx")}
          >
            {downloading === "xlsx" ? "Preparing…" : "Download Excel"}
          </Button>
          <div className="relative" ref={menuRef}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="Run actions"
              aria-expanded={menuOpen}
              className="px-2"
              onClick={() => setMenuOpen((open) => !open)}
            >
              <MoreHorizontal size={16} />
            </Button>
            {menuOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 w-52 rounded-[9px] border border-[#e7e3db] bg-white py-1 shadow-md">
                {EXPORT_MENU_FORMATS.map((entry) => (
                  <button
                    key={entry.format}
                    type="button"
                    disabled={downloading !== null}
                    className="w-full px-3 py-2 text-left text-[13px] text-[#1c1b19] hover:bg-[#f5f3ee] disabled:text-[#c9c3b5]"
                    onClick={() => startDownload(entry.format)}
                  >
                    {exportLabel(entry, downloading)}
                  </button>
                ))}
                <div className="my-1 border-t border-[#e7e3db]" />
                <button
                  type="button"
                  disabled={generateMutation.isPending}
                  className="w-full px-3 py-2 text-left text-[13px] text-[#1c1b19] hover:bg-[#f5f3ee] disabled:text-[#c9c3b5]"
                  onClick={() => {
                    setMenuOpen(false);
                    generateMutation.mutate({ runId });
                  }}
                >
                  {generateMutation.isPending ? "Generating…" : "Generate documents"}
                </button>
                {generated ? (
                  <>
                    <a
                      href={artifactHref(runId, "document")}
                      className="block px-3 py-2 text-left text-[13px] text-[#1c1b19] hover:bg-[#f5f3ee]"
                      onClick={() => setMenuOpen(false)}
                    >
                      Download document
                    </a>
                    <a
                      href={artifactHref(runId, "summary-doc")}
                      className="block px-3 py-2 text-left text-[13px] text-[#1c1b19] hover:bg-[#f5f3ee]"
                      onClick={() => setMenuOpen(false)}
                    >
                      Download summary doc
                    </a>
                  </>
                ) : null}
                <div className="my-1 border-t border-[#e7e3db]" />
                <Link
                  href={`/synthesise/${flowId}/runs`}
                  className="block px-3 py-2 text-left text-[13px] text-[#1c1b19] hover:bg-[#f5f3ee]"
                  onClick={() => setMenuOpen(false)}
                >
                  All runs
                </Link>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto flex max-w-[1100px] flex-col gap-[16px] px-[20px] py-[20px]">
          <div className="rounded-[10px] border border-[#e7e3db] bg-white px-[14px] py-[10px]">
            <RunProgress runId={runId} />
          </div>

          {resultsQuery.error ? (
            <p className="text-[13px] text-[#b23b30]">{resultsQuery.error.message}</p>
          ) : null}

          {!data || !result ? (
            resultsQuery.error ? null : (
              <p className="text-[13px] text-[#736d5f]">Loading results…</p>
            )
          ) : (
            <>
              <div className="flex flex-wrap justify-end gap-[8px]">
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

              {summaryMarkdown ? (
                <SummaryPreview
                  markdown={summaryMarkdown}
                  downloadHref={artifactHref(runId, "summary-doc")}
                />
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

              <RunReport runId={runId} live={live} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
