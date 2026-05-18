"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/trpc/client";

export default function AdminUsagePage() {
  const summaryQuery = trpc.usage.summary.useQuery(undefined);

  const totalCost =
    summaryQuery.data?.reduce((acc, r) => acc + r.totalCostUsd, 0) ?? 0;
  const totalTokens =
    summaryQuery.data?.reduce(
      (acc, r) => acc + r.totalPromptTokens + r.totalCompletionTokens,
      0,
    ) ?? 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Estimated cost
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">${totalCost.toFixed(4)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total tokens
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{totalTokens.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Model variants
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{summaryQuery.data?.length ?? 0}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Usage by model</CardTitle>
        </CardHeader>
        <CardContent>
          {summaryQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Calls</TableHead>
                  <TableHead>Input tokens</TableHead>
                  <TableHead className="text-green-600 dark:text-green-400">Cache read</TableHead>
                  <TableHead className="text-yellow-600 dark:text-yellow-400">Cache write</TableHead>
                  <TableHead>Output tokens</TableHead>
                  <TableHead>Estimated cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summaryQuery.data?.map((r) => (
                  <TableRow key={`${r.provider}::${r.model}`}>
                    <TableCell className="font-mono text-xs">{r.provider}</TableCell>
                    <TableCell className="font-mono text-xs">{r.model}</TableCell>
                    <TableCell>{r.eventCount.toLocaleString()}</TableCell>
                    <TableCell>{r.totalPromptTokens.toLocaleString()}</TableCell>
                    <TableCell className="text-green-600 dark:text-green-400">{r.totalCacheReadTokens.toLocaleString()}</TableCell>
                    <TableCell className="text-yellow-600 dark:text-yellow-400">{r.totalCacheWriteTokens.toLocaleString()}</TableCell>
                    <TableCell>{r.totalCompletionTokens.toLocaleString()}</TableCell>
                    <TableCell>${r.totalCostUsd.toFixed(4)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
