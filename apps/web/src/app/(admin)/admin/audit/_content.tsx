"use client";

import type { AuditLog } from "@rbrasier/domain";
import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/trpc/client";
import { LegalHoldsCard } from "./_legal-holds";

const PAGE_SIZE = 50;

interface Filters {
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: Filters = {
  actorId: "",
  action: "",
  resourceType: "",
  resourceId: "",
  from: "",
  to: "",
};

interface AppliedQuery {
  actorId?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  from?: Date;
  to?: Date;
  limit: number;
  offset: number;
}

const toQuery = (filters: Filters, offset: number): AppliedQuery => ({
  actorId: filters.actorId.trim() || undefined,
  action: filters.action.trim() || undefined,
  resourceType: filters.resourceType.trim() || undefined,
  resourceId: filters.resourceId.trim() || undefined,
  from: filters.from ? new Date(filters.from) : undefined,
  to: filters.to ? new Date(filters.to) : undefined,
  limit: PAGE_SIZE,
  offset,
});

const triggerDownload = (filename: string, contentType: string, content: string): void => {
  const blob = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

export function AdminAuditContent() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<AppliedQuery>(toQuery(EMPTY_FILTERS, 0));
  const [selected, setSelected] = useState<AuditLog | null>(null);

  const searchQuery = trpc.audit.search.useQuery(applied);
  const exportMutation = trpc.audit.export.useMutation({
    onSuccess: (data) => triggerDownload(data.filename, data.contentType, data.content),
  });
  const utils = trpc.useUtils();
  const [verifyState, setVerifyState] = useState<
    { intact: boolean; rows: number } | null
  >(null);
  const [verifying, setVerifying] = useState(false);

  const runSearch = (offset: number) => {
    const query = toQuery(filters, offset);
    setApplied(query);
  };

  const setField = (key: keyof Filters) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setFilters((current) => ({ ...current, [key]: event.target.value }));

  const page = searchQuery.data;
  const total = page?.total ?? 0;
  const offset = applied.offset;

  const runVerify = async () => {
    setVerifying(true);
    try {
      const result = await utils.audit.verifyChain.fetch();
      setVerifyState({ intact: result.intact, rows: result.rows });
    } finally {
      setVerifying(false);
    }
  };

  const exportFilters = {
    actorId: applied.actorId,
    action: applied.action,
    resourceType: applied.resourceType,
    resourceId: applied.resourceId,
    from: applied.from,
    to: applied.to,
  };

  return (
    <div className="h-full overflow-auto">
      <div className="container space-y-6 py-8">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Audit log</CardTitle>
            <div className="flex items-center gap-2">
              {verifyState && (
                <Badge variant={verifyState.intact ? "secondary" : "destructive"}>
                  {verifyState.intact
                    ? `Chain intact (${verifyState.rows} rows)`
                    : "Chain broken — tampering detected"}
                </Badge>
              )}
              <Button variant="outline" size="sm" onClick={runVerify} disabled={verifying}>
                {verifying ? "Verifying…" : "Verify integrity"}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="filter-actor">Actor ID</Label>
                <Input id="filter-actor" value={filters.actorId} onChange={setField("actorId")} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="filter-action">Action</Label>
                <Input id="filter-action" value={filters.action} onChange={setField("action")} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="filter-restype">Resource type</Label>
                <Input
                  id="filter-restype"
                  value={filters.resourceType}
                  onChange={setField("resourceType")}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="filter-resid">Resource ID</Label>
                <Input
                  id="filter-resid"
                  value={filters.resourceId}
                  onChange={setField("resourceId")}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="filter-from">From</Label>
                <Input
                  id="filter-from"
                  type="datetime-local"
                  value={filters.from}
                  onChange={setField("from")}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="filter-to">To</Label>
                <Input
                  id="filter-to"
                  type="datetime-local"
                  value={filters.to}
                  onChange={setField("to")}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => runSearch(0)}>
                Search
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setFilters(EMPTY_FILTERS);
                  setApplied(toQuery(EMPTY_FILTERS, 0));
                }}
              >
                Clear
              </Button>
              <div className="ml-auto flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={exportMutation.isPending}
                  onClick={() => exportMutation.mutate({ ...exportFilters, format: "csv" })}
                >
                  Export CSV
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={exportMutation.isPending}
                  onClick={() => exportMutation.mutate({ ...exportFilters, format: "json" })}
                >
                  Export JSON
                </Button>
              </div>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Resource</TableHead>
                  <TableHead>Seq</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(page?.rows ?? []).map((row) => (
                  <TableRow
                    key={row.id}
                    className="cursor-pointer"
                    onClick={() => setSelected(row)}
                  >
                    <TableCell>{new Date(row.createdAt).toLocaleString()}</TableCell>
                    <TableCell>{row.actorId ?? "—"}</TableCell>
                    <TableCell>{row.action}</TableCell>
                    <TableCell>
                      {row.resourceType}
                      {row.resourceId ? ` · ${row.resourceId}` : ""}
                    </TableCell>
                    <TableCell>{row.sequence}</TableCell>
                  </TableRow>
                ))}
                {page && page.rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-[#6d6a65]">
                      No audit events match these filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>

            <div className="flex items-center justify-between">
              <span className="text-[13px] text-[#6d6a65]">
                {total === 0
                  ? "0 events"
                  : `${offset + 1}–${Math.min(offset + PAGE_SIZE, total)} of ${total}`}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={offset === 0}
                  onClick={() => runSearch(Math.max(0, offset - PAGE_SIZE))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={offset + PAGE_SIZE >= total}
                  onClick={() => runSearch(offset + PAGE_SIZE)}
                >
                  Next
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <LegalHoldsCard />
      </div>

      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Audit event</DialogTitle>
          </DialogHeader>
          {selected && (
            <dl className="space-y-2 text-[13px]">
              <Detail label="ID" value={selected.id} />
              <Detail label="Sequence" value={String(selected.sequence)} />
              <Detail label="Time" value={new Date(selected.createdAt).toISOString()} />
              <Detail label="Actor" value={selected.actorId ?? "—"} />
              <Detail label="Action" value={selected.action} />
              <Detail label="Resource type" value={selected.resourceType} />
              <Detail label="Resource ID" value={selected.resourceId ?? "—"} />
              <Detail label="Hash" value={selected.hash} />
              <div>
                <dt className="font-semibold uppercase text-[11px] text-[#6d6a65]">Metadata</dt>
                <dd>
                  <pre className="mt-1 overflow-x-auto rounded bg-[#f7f6f3] p-2 text-[12px]">
                    {JSON.stringify(selected.metadata, null, 2)}
                  </pre>
                </dd>
              </div>
            </dl>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-32 shrink-0 font-semibold uppercase text-[11px] text-[#6d6a65]">{label}</dt>
      <dd className="break-all">{value}</dd>
    </div>
  );
}
