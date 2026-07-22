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

  // Guard the loading window explicitly: without this the actionable "New
  // synthesis" button renders while the gated query is still in flight, so a
  // flag-off error that arrives later unmounts the subtree mid-interaction.
  if (flowsQuery.isLoading) {
    return (
      <div className="mx-auto max-w-[900px] px-[20px] py-[28px]">
        <p className="text-[13px] text-[#8a857c]">Loading…</p>
      </div>
    );
  }

  if (flowsQuery.error) {
    return (
      <div className="mx-auto max-w-[900px] px-[20px] py-[28px]">
        <EmptyState
          heading="Synthesise Information is not available"
          body="This feature is not enabled for your account. Ask an administrator to enable it."
        />
      </div>
    );
  }

  const rows: ExtractionFlowRow[] = (flowsQuery.data ?? []).map((flow) => ({
    id: flow.id,
    name: flow.name,
    status: flow.status,
    runs: [],
  }));

  return (
    <div className="mx-auto max-w-[900px] px-[20px] py-[28px]">
      <div className="mb-[20px] flex items-center justify-between">
        <div>
          <h1 className="text-[20px] font-bold text-[#1a1814]">Synthesise Information</h1>
          <p className="mt-[2px] text-[13px] text-[#6d6a65]">
            Pull the same fields from many documents at once.
          </p>
        </div>
        <Button type="button" onClick={() => setCreating(true)}>
          New synthesis
        </Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          heading="No syntheses yet"
          body="Create one to define a schema and sample it over a few documents."
        />
      ) : (
        <ExtractionList flows={rows} editable />
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New synthesis</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-[6px]">
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
