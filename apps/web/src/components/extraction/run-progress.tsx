"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { trpc } from "@/trpc/client";
import { isProcessing, shouldDriveTick } from "./run-tick-state";

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
      setTickBlocked(false);
      refresh();
    },
    onError: (error) => toast.error(error.message),
  });
  const continueMutation = trpc.extraction.continue.useMutation({
    onSuccess: () => {
      setTickBlocked(false);
      refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  // A run only advances when something drives the batch engine. The background
  // worker may be off or on a slower cadence than an operator watching the
  // screen, so while the run is live this screen advances it one batch at a
  // time (see run-tick-state for the rules). Claiming is SKIP LOCKED, so this
  // never double-processes a document against the worker.
  const [tickBlocked, setTickBlocked] = useState(false);
  const tickMutation = trpc.extraction.tick.useMutation({
    onSuccess: refresh,
    onError: (error) => {
      // Stop driving after a failure so a persistent error is not a hot loop;
      // the background worker keeps retrying the run.
      setTickBlocked(true);
      toast.error(error.message, { id: `extraction-tick-${runId}` });
    },
  });

  const run = statusQuery.data?.run;
  const counts = statusQuery.data?.counts;
  const processing = isProcessing(run?.status);
  const { mutate: startTick, isPending: tickInFlight } = tickMutation;
  const driveTick = shouldDriveTick({ status: run?.status, tickInFlight, tickBlocked });

  useEffect(() => {
    if (!driveTick) return;
    startTick({ runId });
  }, [driveTick, runId, startTick]);

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
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="flex items-center gap-1.5 font-medium capitalize text-foreground">
          {processing ? <Spinner /> : null}
          {run.status.replace("_", " ")}
        </span>
        <span className="text-muted-foreground">
          {processed} of {run.totalCount} documents processed
        </span>
        <span className="ml-auto text-muted-foreground">${run.costUsd.toFixed(2)}</span>
      </div>

      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
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

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>Complete: {counts.complete}</span>
        <span>Failed: {counts.failed}</span>
        <span>Unreadable: {counts.unreadable}</span>
        <span className="ml-auto flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant="outline"
            disabled={!isPaused || continueMutation.isPending}
            onClick={() => continueMutation.mutate({ runId })}
          >
            Process all documents
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={counts.failed === 0 || retryMutation.isPending}
            onClick={() => retryMutation.mutate({ runId })}
          >
            Retry failed
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={isTerminal || cancelMutation.isPending}
            onClick={() => cancelMutation.mutate({ runId })}
          >
            Cancel
          </Button>
        </span>
      </div>
    </div>
  );
}
