"use client";

import { useMemo } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { trpc } from "@/trpc/client";

// The run screen (phase §8). Polls COUNT(*) GROUP BY status while the run is
// live and renders `x of y` on a bar with a marker at the preview breakpoint,
// live cost, and failure count. Controls — cancel, retry-failed, continue — map
// to the run-control procedures. All gating is server-side; the buttons only
// reflect what the run's status allows.
const LIVE_STATUSES = new Set(["running", "paused_preview", "paused_cap"]);
const POLL_INTERVAL_MS = 2000;

export interface RunProgressProps {
  runId: string;
}

export function RunProgress({ runId }: RunProgressProps) {
  const utils = trpc.useUtils();
  const statusQuery = trpc.extraction.runStatus.useQuery(
    { runId },
    {
      refetchInterval: (query) => {
        const status = query.state.data?.run.status;
        return status && LIVE_STATUSES.has(status) ? POLL_INTERVAL_MS : false;
      },
    },
  );

  const refresh = () => {
    void utils.extraction.runStatus.invalidate({ runId });
  };

  const cancelMutation = trpc.extraction.cancel.useMutation({
    onSuccess: refresh,
    onError: (error) => toast.error(error.message),
  });
  const retryMutation = trpc.extraction.retryFailed.useMutation({
    onSuccess: (data) => {
      toast.success(`Requeued ${data.retried} document(s)`);
      refresh();
    },
    onError: (error) => toast.error(error.message),
  });
  const continueMutation = trpc.extraction.continue.useMutation({
    onSuccess: refresh,
    onError: (error) => toast.error(error.message),
  });

  const run = statusQuery.data?.run;
  const counts = statusQuery.data?.counts;

  const processed = useMemo(() => {
    if (!counts) return 0;
    return counts.complete + counts.failed + counts.unreadable;
  }, [counts]);

  if (statusQuery.isLoading || !run || !counts) {
    return <p className="text-sm text-muted-foreground">Loading run…</p>;
  }

  const total = run.totalCount || 1;
  const processedPercent = Math.min(100, Math.round((processed / total) * 100));
  const previewPercent =
    run.previewBoundary > 0 ? Math.min(100, Math.round((run.previewBoundary / total) * 100)) : null;
  const isPaused = run.status === "paused_preview" || run.status === "paused_cap";
  const isTerminal =
    run.status === "complete" || run.status === "partial" || run.status === "cancelled";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium capitalize">{run.status.replace("_", " ")}</p>
        <p className="text-sm text-muted-foreground">
          {processed} of {run.totalCount} documents processed
        </p>
      </div>

      <div className="relative h-3 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${processedPercent}%` }}
        />
        {previewPercent !== null ? (
          <div
            className="absolute top-0 h-full w-0.5 bg-foreground/60"
            style={{ left: `${previewPercent}%` }}
            aria-label="Preview breakpoint"
            title="Preview breakpoint"
          />
        ) : null}
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
        <span>Complete: {counts.complete}</span>
        <span>Failed: {counts.failed}</span>
        <span>Unreadable: {counts.unreadable}</span>
        <span>Cost: ${run.costUsd.toFixed(2)}</span>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={!isPaused || continueMutation.isPending}
          onClick={() => continueMutation.mutate({ runId })}
        >
          Continue processing
        </Button>
        <Button
          variant="outline"
          disabled={counts.failed === 0 || retryMutation.isPending}
          onClick={() => retryMutation.mutate({ runId })}
        >
          Retry failed
        </Button>
        <Button
          variant="destructive"
          disabled={isTerminal || cancelMutation.isPending}
          onClick={() => cancelMutation.mutate({ runId })}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
