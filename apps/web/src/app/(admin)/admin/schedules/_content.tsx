"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { TableSkeletonRows } from "@/components/skeleton/card-skeleton";
import { trpc } from "@/trpc/client";

const outcomeVariant = (outcome: string) => {
  if (outcome === "failed") return "destructive";
  if (outcome === "completed") return "secondary";
  return "default";
};

const formatDateTime = (date: Date | string | null) => {
  if (!date) return "—";
  return new Date(date).toLocaleString();
};

export function AdminSchedulesContent() {
  const runsQuery = trpc.schedule.listRecentRuns.useQuery(undefined);
  const runs = runsQuery.data ?? [];

  return (
    <div className="h-full overflow-auto">
      <div className="container py-8">
        <Card>
          <CardHeader>
            <CardTitle>Scheduled Run History</CardTitle>
          </CardHeader>
          <CardContent>
            {runsQuery.isLoading ? (
              <TableSkeletonRows count={4} />
            ) : runs.length === 0 ? (
              <EmptyState
                icon="⏰"
                heading="No scheduled runs yet"
                body="Each time a scheduled or recurring step fires, its outcome is logged here."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Flow</TableHead>
                    <TableHead>Step</TableHead>
                    <TableHead>Session</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Occurrence</TableHead>
                    <TableHead>Fired</TableHead>
                    <TableHead>Next fire</TableHead>
                    <TableHead>Error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run) => (
                    <TableRow key={run.id}>
                      <TableCell className="font-medium max-w-[160px] truncate">
                        {run.flowName ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground max-w-[160px] truncate">
                        {run.nodeName ?? "—"}
                      </TableCell>
                      <TableCell className="max-w-[160px] truncate">
                        <Link href={`/chats/${run.sessionId}`} className="text-indigo-600 hover:underline">
                          {run.sessionTitle ?? "Untitled"}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant={outcomeVariant(run.outcome)} className="capitalize text-xs">
                          {run.outcome}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">{run.occurrence}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {formatDateTime(run.firedAt)}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {formatDateTime(run.nextFireAt)}
                      </TableCell>
                      <TableCell className="text-destructive text-sm max-w-[220px] truncate">
                        {run.error ?? "—"}
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
