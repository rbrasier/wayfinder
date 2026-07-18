"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

type ScopeKind = "global" | "by_session";

export function LegalHoldsCard() {
  const utils = trpc.useUtils();
  const holdsQuery = trpc.legalHold.list.useQuery();
  const invalidate = () => void utils.legalHold.list.invalidate();
  const createMutation = trpc.legalHold.create.useMutation({ onSuccess: invalidate });
  const releaseMutation = trpc.legalHold.release.useMutation({ onSuccess: invalidate });

  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [scopeKind, setScopeKind] = useState<ScopeKind>("global");
  const [sessionId, setSessionId] = useState("");

  const canCreate =
    name.trim().length > 0 && (scopeKind === "global" || sessionId.trim().length > 0);

  const submit = () => {
    createMutation.mutate({
      name: name.trim(),
      reason: reason.trim() || null,
      scope:
        scopeKind === "global"
          ? { kind: "global" }
          : { kind: "by_session", sessionId: sessionId.trim() },
    });
    setName("");
    setReason("");
    setSessionId("");
    setScopeKind("global");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Legal holds</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor="hold-name">Name</Label>
            <Input id="hold-name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="hold-reason">Reason</Label>
            <Input
              id="hold-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="hold-scope">Scope</Label>
            <select
              id="hold-scope"
              className="flex w-full rounded-[9px] border border-[#dedad2] bg-[#f7f6f3] px-3 py-[9px] text-[13px]"
              value={scopeKind}
              onChange={(event) => setScopeKind(event.target.value as ScopeKind)}
            >
              <option value="global">Global (freeze all retention)</option>
              <option value="by_session">By session</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="hold-session">Session ID</Label>
            <Input
              id="hold-session"
              value={sessionId}
              disabled={scopeKind !== "by_session"}
              onChange={(event) => setSessionId(event.target.value)}
            />
          </div>
        </div>
        <Button size="sm" disabled={!canCreate || createMutation.isPending} onClick={submit}>
          Place hold
        </Button>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Scope</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(holdsQuery.data ?? []).map((hold) => {
              const active = hold.releasedAt === null;
              return (
                <TableRow key={hold.id}>
                  <TableCell>{hold.name}</TableCell>
                  <TableCell>
                    {hold.scope.kind === "global"
                      ? "Global"
                      : `Session · ${hold.scope.sessionId}`}
                  </TableCell>
                  <TableCell>
                    <Badge variant={active ? "destructive" : "secondary"}>
                      {active ? "Active" : "Released"}
                    </Badge>
                  </TableCell>
                  <TableCell>{new Date(hold.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell className="text-right">
                    {active && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={releaseMutation.isPending}
                        onClick={() => releaseMutation.mutate({ id: hold.id })}
                      >
                        Release
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {holdsQuery.data && holdsQuery.data.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-[#6d6a65]">
                  No legal holds.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
