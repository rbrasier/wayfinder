"use client";

import type { ErrorLogStatus } from "@rbrasier/domain";
import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/trpc/client";

const statusVariant = (s: ErrorLogStatus) => {
  if (s === "active") return "destructive" as const;
  if (s === "resolved") return "secondary" as const;
  return "outline" as const;
};

interface OpenGroup {
  message: string;
  page: string | null;
}

const sameGroup = (a: OpenGroup, b: { message: string; page: string | null }): boolean =>
  a.message === b.message && a.page === b.page;

export function AdminErrorsContent() {
  const utils = trpc.useUtils();
  const groupsQuery = trpc.error.listGrouped.useQuery({});
  const updateStatus = trpc.error.updateStatus.useMutation({
    onSuccess: () => {
      void utils.error.listGrouped.invalidate();
      void utils.error.listInGroup.invalidate();
    },
  });
  const deleteAllMutation = trpc.error.deleteAll.useMutation({
    onSuccess: () => {
      void utils.error.listGrouped.invalidate();
      void utils.error.listInGroup.invalidate();
      setConfirmDeleteAll(false);
    },
  });

  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [open, setOpen] = useState<OpenGroup | null>(null);
  const groupQuery = trpc.error.listInGroup.useQuery(
    open ? { message: open.message, page: open.page } : { message: "", page: null },
    { enabled: open !== null },
  );

  return (
    <div className="h-full overflow-auto">
    <div className="container py-8">
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Errors</CardTitle>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setConfirmDeleteAll(true)}
          disabled={deleteAllMutation.isPending}
        >
          Delete all
        </Button>
      </CardHeader>
      <CardContent>
        {groupsQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead>Page</TableHead>
                <TableHead>Count</TableHead>
                <TableHead>Last seen</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groupsQuery.data?.map((g) => {
                const isOpen = open !== null && sameGroup(open, g);
                return (
                  <React.Fragment key={`${g.message}::${g.page ?? ""}`}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() =>
                        setOpen(isOpen ? null : { message: g.message, page: g.page })
                      }
                    >
                      <TableCell className="max-w-[36ch] truncate font-medium">
                        {g.message}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{g.page ?? "—"}</TableCell>
                      <TableCell>{g.count}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(g.lastSeen).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <select
                          value={g.status}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) =>
                            updateStatus.mutate({
                              message: g.message,
                              page: g.page,
                              status: e.target.value as ErrorLogStatus,
                            })
                          }
                          className="rounded-md border bg-background px-2 py-1 text-xs"
                        >
                          <option value="active">active</option>
                          <option value="dismissed">dismissed</option>
                          <option value="resolved">resolved</option>
                        </select>
                        <Badge variant={statusVariant(g.status)} className="ml-2">
                          {g.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                    {isOpen && (
                      <TableRow>
                        <TableCell colSpan={5} className="bg-muted/40">
                          {groupQuery.isLoading ? (
                            <p className="text-sm text-muted-foreground">Loading…</p>
                          ) : (
                            <ul className="space-y-3">
                              {groupQuery.data?.map((row) => (
                                <li key={row.id} className="rounded-md border bg-background p-3 text-xs">
                                  <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
                                    <span>{new Date(row.createdAt).toLocaleString()}</span>
                                    {row.userId && <span>· user {row.userId.slice(0, 8)}</span>}
                                    <Badge variant="outline">{row.level}</Badge>
                                  </div>
                                  {row.stack && (
                                    <pre className="mt-2 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-muted-foreground">
                                      {row.stack}
                                    </pre>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <Dialog open={confirmDeleteAll} onOpenChange={(o) => !o && setConfirmDeleteAll(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete all errors?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete all error log entries. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDeleteAll(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteAllMutation.isPending}
              onClick={() => deleteAllMutation.mutate()}
            >
              {deleteAllMutation.isPending ? "Deleting…" : "Delete all"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
    </div>
    </div>
  );
}
