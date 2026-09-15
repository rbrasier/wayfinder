"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/trpc/client";
import {
  KEEP_FOREVER_LABEL,
  LEGAL_HOLD_NOTE,
  parseWindowInput,
  retentionRows,
} from "./retention-card-model";

// Data retention windows, moved out of environment variables so an operator can
// see and change them without a redeploy (ADR-041 §2: DB-first, env as
// fallback). Every window defaults to keep forever.
export function RetentionCard() {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const policiesQuery = trpc.settings.retention.useQuery();
  const utils = trpc.useUtils();

  const save = trpc.settings.setRetentionWindow.useMutation({
    onSuccess: async () => {
      toast.success("Retention window saved.");
      await utils.settings.retention.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const rows = retentionRows(policiesQuery.data ?? []);

  const onSave = (key: string, raw: string) => {
    const parsed = parseWindowInput(raw);
    if (parsed === null) {
      toast.error("Enter a whole number of days, or 0 to keep forever.");
      return;
    }
    save.mutate({ key, retentionDays: parsed });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Data retention</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          How long each kind of record is kept before the nightly sweep removes it.{" "}
          <strong>0 means {KEEP_FOREVER_LABEL.toLowerCase()}</strong>, which is the default for
          every one. {LEGAL_HOLD_NOTE}
        </p>

        {policiesQuery.isPending ? <p className="text-sm text-muted-foreground">Loading…</p> : null}

        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.key} className="flex flex-wrap items-end gap-3 border-b pb-3 last:border-0">
              <div className="min-w-48 flex-1">
                <Label htmlFor={`retention-${row.key}`}>{row.label}</Label>
                <p className="text-xs text-muted-foreground">
                  {row.isSweeping ? `Currently ${row.windowLabel}.` : `Currently ${row.windowLabel}.`}
                  {row.note ? ` ${row.note}` : ""}
                </p>
              </div>
              <Input
                id={`retention-${row.key}`}
                type="number"
                min={0}
                step={1}
                className="w-28"
                value={drafts[row.key] ?? String(row.retentionDays)}
                onChange={(event) =>
                  setDrafts((current) => ({ ...current, [row.key]: event.target.value }))
                }
              />
              <Button
                type="button"
                variant="outline"
                disabled={save.isPending}
                onClick={() => onSave(row.key, drafts[row.key] ?? String(row.retentionDays))}
              >
                Save
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
