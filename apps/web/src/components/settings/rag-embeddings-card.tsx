"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { trpc } from "@/trpc/client";
import { ConnectivityTest, type ConnectivityController } from "./connectivity";

type EmbeddingsProviderChoice = "local" | "openai";

const EMBEDDINGS_PROVIDER_LABEL: Record<EmbeddingsProviderChoice, string> = {
  local: "Local (in-process)",
  openai: "OpenAI",
};

export function RagEmbeddingsCard({ connectivity }: { connectivity: ConnectivityController }) {
  const utils = trpc.useUtils();
  const configQuery = trpc.settings.getEmbeddingsConfig.useQuery();
  const saveMutation = trpc.settings.setEmbeddingsConfig.useMutation({
    onSuccess: async () => {
      toast.success("Embedding provider saved — re-index documents to use it");
      await utils.settings.getEmbeddingsConfig.invalidate();
      setOpen(false);
    },
    onError: (error) => toast.error(error.message ?? "Failed to save embedding provider"),
  });

  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<EmbeddingsProviderChoice>("local");
  // Only badge runs that completed while this card was on screen, so navigating
  // away and back does not re-surface a stale "Completed" badge.
  const [mountedAt] = useState(() => Date.now());

  const reindexStatusQuery = trpc.settings.reindexStatus.useQuery(undefined, {
    refetchInterval: (query) => (query.state.data?.status === "running" ? 5000 : false),
  });
  const startReindexMutation = trpc.settings.startReindex.useMutation({
    onSuccess: async (result) => {
      if (!result.started) toast.info("A re-index is already running");
      await utils.settings.reindexStatus.invalidate();
    },
    onError: (error) => toast.error(error.message ?? "Failed to start re-indexing"),
  });

  const config = configQuery.data;
  const reindexStatus = reindexStatusQuery.data;
  const isReindexing = reindexStatus?.status === "running";
  const finishedAfterMount =
    reindexStatus?.finishedAt != null &&
    new Date(reindexStatus.finishedAt).getTime() >= mountedAt;
  const showReindexComplete = reindexStatus?.status === "complete" && finishedAfterMount;
  const showReindexFailed = reindexStatus?.status === "failed" && finishedAfterMount;

  useEffect(() => {
    if (!open || !config) return;
    setProvider(config.provider as EmbeddingsProviderChoice);
  }, [open, config]);

  const handleSave = () => {
    saveMutation.mutate({ provider });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">RAG Embeddings</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={!config}>
          Edit
        </Button>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground">
          Which model embeds uploaded documents for retrieval. Local runs in-process with no
          external API; OpenAI uses the hosted model.
        </p>
        {!config ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Provider</span>
              <span className="font-medium">
                {EMBEDDINGS_PROVIDER_LABEL[config.provider as EmbeddingsProviderChoice] ??
                  config.provider}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Model</span>
              <span className="font-mono text-xs">{config.model}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Dimensions</span>
              <span className="font-mono text-xs">{config.dimension}</span>
            </div>
          </>
        )}

        <div className="space-y-2 border-t pt-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">
              Re-embed every stored document (templates, flow context docs, session
              uploads) with the current provider.
            </span>
            <Button
              size="sm"
              variant="outline"
              data-testid="reindex-button"
              onClick={() => startReindexMutation.mutate()}
              disabled={startReindexMutation.isPending || isReindexing}
            >
              {isReindexing ? "Re-indexing…" : "Re-index all documents"}
            </Button>
          </div>
          {isReindexing && reindexStatus ? (
            <p data-testid="reindex-progress" className="text-xs text-muted-foreground">
              In progress — {reindexStatus.processed} of {reindexStatus.total} documents
              {reindexStatus.failed > 0 ? ` (${reindexStatus.failed} failed)` : ""}…
            </p>
          ) : null}
          {showReindexComplete && reindexStatus ? (
            <p
              data-testid="reindex-complete"
              className="inline-flex rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs text-emerald-900"
            >
              Completed — re-indexed {reindexStatus.succeeded} of {reindexStatus.total} documents
              {reindexStatus.failed > 0 ? `, ${reindexStatus.failed} failed` : ""}.
            </p>
          ) : null}
          {showReindexFailed && reindexStatus ? (
            <p
              data-testid="reindex-failed"
              className="inline-flex rounded-md border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-900"
            >
              Re-index failed{reindexStatus.error ? `: ${reindexStatus.error}` : ""}.
            </p>
          ) : null}
        </div>
        {config && <ConnectivityTest target="embeddings" controller={connectivity} />}
      </CardContent>

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit embedding provider</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="embeddings-provider">Provider</Label>
              <select
                id="embeddings-provider"
                value={provider}
                onChange={(e) => setProvider(e.target.value as EmbeddingsProviderChoice)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="local">Local (in-process)</option>
                <option value="openai">OpenAI</option>
              </select>
            </div>
            <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
              Changing the provider changes how documents are embedded. Existing chunks stay embedded
              with the previous model and will not match queries until each document is re-uploaded or
              re-indexed. OpenAI also requires an OpenAI API key to be configured.
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={saveMutation.isPending}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
