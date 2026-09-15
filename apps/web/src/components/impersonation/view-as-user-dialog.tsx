"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { trpc } from "@/trpc/client";

interface ViewAsUserDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function ViewAsUserDialog({ open, onOpenChange }: ViewAsUserDialogProps) {
  const [search, setSearch] = useState("");
  const [startingFor, setStartingFor] = useState<string | null>(null);

  const targetsQuery = trpc.impersonation.listTargets.useQuery(
    { search: search.trim() || undefined },
    { enabled: open },
  );
  const [startError, setStartError] = useState<string | null>(null);

  // A REST route, not a tRPC mutation: the cookie it sets cannot ride the
  // streamed tRPC response (see lib/impersonation-actions.ts).
  const startViewingAs = async (userId: string): Promise<void> => {
    setStartingFor(userId);
    setStartError(null);
    try {
      const response = await fetch("/api/impersonation/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setStartError(body.error ?? "Could not start viewing as that user.");
        setStartingFor(null);
        return;
      }
      // A full load, not a router.push: every server component must re-render
      // under the new principal rather than replay a cached tree.
      window.location.href = "/chats";
    } catch {
      setStartError("Could not start viewing as that user.");
      setStartingFor(null);
    }
  };

  const targets = targetsQuery.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>View as user</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>
        <DialogBody>
          <p className="mb-3 text-sm text-muted-foreground">
            See Wayfinder exactly as someone else sees it. Everything you do is recorded
            against your own name as well as theirs.
          </p>

          <div className="relative mb-3">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-[9px] top-1/2 h-[14px] w-[14px] -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name or email"
              aria-label="Search users"
              className="pl-[28px]"
            />
          </div>

          {targetsQuery.isError && (
            <p className="py-6 text-center text-sm text-destructive">
              Could not load the list of users. Try again in a moment.
            </p>
          )}

          {!targetsQuery.isError && targetsQuery.isPending && (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading users…</p>
          )}

          {!targetsQuery.isError && !targetsQuery.isPending && targets.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {search.trim() ? `No users match “${search.trim()}”.` : "There is nobody else to view as."}
            </p>
          )}

          <ul className="flex max-h-[280px] flex-col gap-[2px] overflow-y-auto">
            {targets.map((target) => (
              <li key={target.id}>
                <Button
                  variant="ghost"
                  className="h-auto w-full justify-start px-[10px] py-[8px] text-left"
                  disabled={startingFor !== null}
                  onClick={() => void startViewingAs(target.id)}
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-[13px] font-medium">
                      {target.name ?? target.email ?? "Unnamed user"}
                    </span>
                    <span className="truncate text-[11px] text-muted-foreground">
                      {target.email}
                      {target.role ? ` · ${target.role}` : ""}
                    </span>
                  </span>
                  {startingFor === target.id && (
                    <span className="ml-auto text-[11px] text-muted-foreground">Starting…</span>
                  )}
                </Button>
              </li>
            ))}
          </ul>

          {startError && <p className="pt-3 text-sm text-destructive">{startError}</p>}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
