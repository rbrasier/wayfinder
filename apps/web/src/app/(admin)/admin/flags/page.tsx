"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/trpc/client";

export default function AdminFlagsPage() {
  const utils = trpc.useUtils();
  const flagsQuery = trpc.featureFlag.list.useQuery();
  const upsert = trpc.featureFlag.upsert.useMutation({
    onSuccess: () => void utils.featureFlag.list.invalidate(),
  });

  const [newKey, setNewKey] = useState("");

  const toggle = (key: string, enabled: boolean, rolloutPct: number) =>
    upsert.mutate({ key, enabled: !enabled, rolloutPct });

  const create = () => {
    if (!newKey.trim()) return;
    upsert.mutate({ key: newKey.trim(), enabled: false, rolloutPct: 100 });
    setNewKey("");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Feature Flags</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder="new-flag-key"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            className="max-w-xs"
          />
          <Button onClick={create} disabled={upsert.isPending}>
            Add flag
          </Button>
        </div>

        {flagsQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Key</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Rollout %</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {flagsQuery.data?.map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="font-mono text-xs">{f.key}</TableCell>
                  <TableCell>
                    <button
                      onClick={() => toggle(f.key, f.enabled, f.rolloutPct)}
                      disabled={upsert.isPending}
                    >
                      <Badge variant={f.enabled ? "default" : "outline"}>
                        {f.enabled ? "on" : "off"}
                      </Badge>
                    </button>
                  </TableCell>
                  <TableCell className="text-sm">{f.rolloutPct}%</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {f.description ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(f.updatedAt).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
