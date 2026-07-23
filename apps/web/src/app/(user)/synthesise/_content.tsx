"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/empty-state";
import { ExtractionList, type ExtractionFlowRow } from "@/components/extraction/extraction-list";
import { trpc } from "@/trpc/client";

export function SynthesiseContent() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const flowsQuery = trpc.extraction.listMine.useQuery();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  const createMutation = trpc.extraction.create.useMutation({
    onSuccess: (flow) => {
      void utils.extraction.listMine.invalidate();
      setCreating(false);
      setName("");
      router.push(`/synthesise/${flow.id}/edit`);
    },
    onError: (error) => toast.error(error.message),
  });

  const rows: ExtractionFlowRow[] = (flowsQuery.data ?? []).map((flow) => ({
    id: flow.id,
    name: flow.name,
    status: flow.status,
    runs: [],
  }));

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-[#dedad2] bg-white pl-5 pr-[52px]">
        <h1 className="text-[16px] font-bold tracking-[-0.3px] text-[#1a1814]">
          Synthesise Information
        </h1>
        {!flowsQuery.error && (
          <Button onClick={() => setCreating(true)}>New synthesis</Button>
        )}
      </header>

      <div className="flex-1 overflow-auto">
        <div className="container py-6">
          {flowsQuery.isLoading ? (
            <p className="text-[13px] text-[#8a857c]">Loading…</p>
          ) : flowsQuery.error ? (
            <EmptyState
              heading="Synthesise Information is not available"
              body="This feature is not enabled for your account. Ask an administrator to enable it."
            />
          ) : rows.length === 0 ? (
            <EmptyState
              icon="🧪"
              heading="No syntheses yet"
              body="Create one to define a schema and sample it over a few documents."
              ctaLabel="New synthesis"
              onCta={() => setCreating(true)}
            />
          ) : (
            <ExtractionList flows={rows} editable />
          )}
        </div>
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New synthesis</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="synthesis-name">Name</Label>
            <Input
              id="synthesis-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Tender responses — RFP 24"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={name.trim().length === 0 || createMutation.isPending}
              onClick={() => createMutation.mutate({ name: name.trim() })}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
