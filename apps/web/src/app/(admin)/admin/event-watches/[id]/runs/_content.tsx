"use client";

import Link from "next/link";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TableSkeletonRows } from "@/components/skeleton/card-skeleton";
import { RunHistoryList } from "@/components/automation/run-history-list";
import { trpc } from "@/trpc/client";

// The runs one watch started, newest first, with Retry on failed ones (ADR-065 §7).
export function EventWatchRunsContent({ watchId }: { watchId: string }) {
  const utils = trpc.useUtils();
  const watchQuery = trpc.eventWatch.get.useQuery({ id: watchId });
  const runsQuery = trpc.eventWatch.runs.useQuery({ id: watchId });
  const [error, setError] = useState<string | null>(null);
  const retry = trpc.automation.retryRun.useMutation({
    onSuccess: () => {
      setError(null);
      void utils.eventWatch.runs.invalidate({ id: watchId });
      void utils.eventWatch.countNeedingAttention.invalidate();
    },
    onError: (cause) => setError(cause.message),
  });

  return (
    <div className="h-full overflow-auto">
      <div className="container max-w-3xl py-8">
        <Link href="/admin/event-watches" className="text-sm text-wf-primary hover:underline">
          ← All watches
        </Link>
        <Card className="mt-3">
          <CardHeader>
            <CardTitle>Run history{watchQuery.data ? `: ${watchQuery.data.watch.name}` : ""}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {runsQuery.isPending ? (
              <TableSkeletonRows count={4} />
            ) : (
              <RunHistoryList
                runs={runsQuery.data ?? []}
                onRetry={(sessionId) => retry.mutate({ sessionId })}
                retryingSessionId={retry.isPending ? (retry.variables?.sessionId ?? null) : null}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
