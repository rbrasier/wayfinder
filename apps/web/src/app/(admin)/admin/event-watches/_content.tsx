"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { TableSkeletonRows } from "@/components/skeleton/card-skeleton";
import { runStatusLabel } from "@/components/automation/run-status";
import { describeCondition, pausedReasonLabel } from "@/components/event-watch/watch-model";
import { trpc } from "@/trpc/client";

const formatWhen = (value: Date | string | null): string => (value ? new Date(value).toLocaleString() : "—");

const everyLabel = (minutes: number): string => (minutes === 1 ? "Every minute" : `Every ${minutes} minutes`);

// Admin → Event Watch (ADR-063): every watch, its health and its latest run,
// with the run history one click away (ADR-065 §7).
export function AdminEventWatchesContent() {
  const utils = trpc.useUtils();
  const listQuery = trpc.eventWatch.list.useQuery(undefined);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => {
    setError(null);
    void utils.eventWatch.list.invalidate();
    void utils.eventWatch.countNeedingAttention.invalidate();
  };
  const pause = trpc.eventWatch.pause.useMutation({ onSuccess: refresh, onError: (cause) => setError(cause.message) });
  const resume = trpc.eventWatch.resume.useMutation({ onSuccess: refresh, onError: (cause) => setError(cause.message) });
  const listings = listQuery.data ?? [];

  return (
    <div className="h-full overflow-auto">
      <div className="container py-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
            <div className="space-y-1">
              <CardTitle>Event Watch</CardTitle>
              <p className="text-sm text-muted-foreground">
                Each watch checks an API on a schedule and starts a flow when an item meets its condition.
              </p>
            </div>
            <Button asChild>
              <Link href="/admin/event-watches/new">New watch</Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {listQuery.isPending ? (
              <TableSkeletonRows count={3} />
            ) : listings.length === 0 ? (
              <EmptyState
                icon="📡"
                heading="No watches yet"
                body="Create a watch to start a flow automatically when something changes in another system."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Watch</TableHead>
                    <TableHead>Starts</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last run</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {listings.map(({ watch, lastRun, flowName, runAsName }) => (
                    <TableRow key={watch.id}>
                      <TableCell className="max-w-[260px] align-top">
                        <Link href={`/admin/event-watches/${watch.id}`} className="font-medium text-wf-primary hover:underline">
                          {watch.name}
                        </Link>
                        <p className="truncate text-xs text-muted-foreground">
                          {everyLabel(watch.intervalMinutes)} · when {describeCondition(watch.condition)}
                        </p>
                      </TableCell>
                      <TableCell className="align-top text-sm">
                        <p>{flowName ?? "Unknown flow"}</p>
                        <p className="text-xs text-muted-foreground">as {runAsName ?? "unknown person"}</p>
                      </TableCell>
                      <TableCell className="max-w-[240px] align-top">
                        {watch.status === "paused" ? (
                          <Badge variant="destructive" className="text-xs">
                            {pausedReasonLabel(watch.pausedReason)}
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">
                            {watch.baselinePending ? "Active · learning current items" : "Active"}
                          </Badge>
                        )}
                        {watch.lastError && (
                          <p className="mt-1 truncate text-xs text-destructive" title={watch.lastError}>
                            {watch.lastError}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="align-top text-sm">
                        {lastRun ? (
                          <>
                            <p>{runStatusLabel(lastRun.status)}</p>
                            <p className="text-xs text-muted-foreground">{formatWhen(lastRun.startedAt)}</p>
                          </>
                        ) : (
                          <p className="text-muted-foreground">No runs yet</p>
                        )}
                        <Link
                          href={`/admin/event-watches/${watch.id}/runs`}
                          className="text-xs text-wf-primary hover:underline"
                        >
                          View run history
                        </Link>
                      </TableCell>
                      <TableCell className="text-right align-top">
                        {watch.status === "paused" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={resume.isPending}
                            onClick={() => resume.mutate({ id: watch.id })}
                          >
                            Resume
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={pause.isPending}
                            onClick={() => pause.mutate({ id: watch.id })}
                          >
                            Pause
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
