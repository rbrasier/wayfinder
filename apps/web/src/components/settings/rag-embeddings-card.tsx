"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { trpc } from "@/trpc/client";
import { ConnectivityTest, type ConnectivityController } from "./connectivity";
import {
  embeddingsProviderLabel,
  isProviderSelectable,
  missingKeyWarning,
  modelAfterProviderChange,
  modelOptionsFor,
  providerSelectionBlockedReason,
  staleDocumentsMessage,
  storedProviderWarning,
} from "./embeddings-provider-state";

type EmbeddingsProviderChoice = "local" | "openai" | "mistral" | "bedrock";

export function RagEmbeddingsCard({ connectivity }: { connectivity: ConnectivityController }) {
  const utils = trpc.useUtils();
  const configQuery = trpc.settings.getEmbeddingsConfig.useQuery();
  const saveMutation = trpc.settings.setEmbeddingsConfig.useMutation({
    onSuccess: async () => {
      toast.success("Embedding model saved — re-index documents to use it");
      await utils.settings.getEmbeddingsConfig.invalidate();
      await utils.settings.embeddingsAttention.invalidate();
      setOpen(false);
    },
    onError: (error) => toast.error(error.message ?? "Failed to save embedding model"),
  });

  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<EmbeddingsProviderChoice>("local");
  const [model, setModel] = useState("");
  // Only badge runs that completed while this card was on screen, so navigating
  // away and back does not re-surface a stale "Completed" badge.
  const [mountedAt] = useState(() => Date.now());

  const reindexStatusQuery = trpc.settings.reindexStatus.useQuery(undefined, {
    refetchInterval: (query) => (query.state.data?.status === "running" ? 5000 : false),
  });
  const reindexState = reindexStatusQuery.data?.status;
  // A finished run re-stamps every chunk, so the stale count must be re-read.
  useEffect(() => {
    if (reindexState !== "complete") return;
    void utils.settings.getEmbeddingsConfig.invalidate();
    void utils.settings.embeddingsAttention.invalidate();
  }, [reindexState, utils]);
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
    setModel(config.model);
  }, [open, config]);

  const handleProviderChange = (nextProvider: EmbeddingsProviderChoice) => {
    setProvider(nextProvider);
    setModel((currentModel) => modelAfterProviderChange(config?.models, nextProvider, currentModel));
  };

  const handleSave = () => {
    saveMutation.mutate({ provider, model });
  };

  const selectionBlockedReason = providerSelectionBlockedReason(config?.providers, provider);
  const canSave = isProviderSelectable(config?.providers, provider);
  const storedWarning = config ? storedProviderWarning(config.providers, config.provider) : null;
  const keyWarning = config ? missingKeyWarning(config.provider, config.keyStatus) : null;
  const staleWarning = config ? staleDocumentsMessage(config.staleDocumentCount) : null;
  const modelOptions = modelOptionsFor(config?.models, provider);

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
          external API; hosted models use the key saved under AI provider.
        </p>
        {!config ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Provider</span>
              <span className="font-medium">
                {embeddingsProviderLabel(config.provider)}
              </span>
            </div>
            {storedWarning ? (
              <p
                data-testid="embeddings-stored-provider-warning"
                className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-900"
              >
                {storedWarning} Retrieval will fail until a hosted provider is selected and
                documents are re-indexed.
              </p>
            ) : null}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Model</span>
              <span className="font-mono text-xs">{config.model}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Model dimensions</span>
              <span className="font-mono text-xs">{config.nativeDimension ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Stored dimensions</span>
              <span className="font-mono text-xs">{config.dimension}</span>
            </div>
            {keyWarning ? (
              <p
                data-testid="embeddings-missing-key"
                className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900"
              >
                {keyWarning}
              </p>
            ) : null}
          </>
        )}

        <div className="space-y-2 border-t pt-3">
          {staleWarning ? (
            <p
              data-testid="embeddings-stale-documents"
              className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900"
            >
              {staleWarning}
            </p>
          ) : null}
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">
              Re-embed every stored document (templates, flow context docs, session
              uploads) with the current model.
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
            <DialogTitle>Edit embedding model</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="embeddings-provider">Provider</Label>
              <select
                id="embeddings-provider"
                value={provider}
                onChange={(e) => handleProviderChange(e.target.value as EmbeddingsProviderChoice)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {(config?.providers ?? []).map((option) => (
                  <option
                    key={option.provider}
                    value={option.provider}
                    disabled={!option.available}
                  >
                    {embeddingsProviderLabel(option.provider)}
                    {option.available ? "" : " — unavailable"}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="embeddings-model">Model</Label>
              <select
                id="embeddings-model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {modelOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label} ({option.nativeDimension} dimensions)
                  </option>
                ))}
              </select>
            </div>
            {selectionBlockedReason ? (
              <p
                data-testid="embeddings-provider-blocked"
                className="rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-900"
              >
                {selectionBlockedReason}
              </p>
            ) : null}
            <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
              {provider === "local"
                ? "Runs in-process; no API key needed."
                : `Uses the ${embeddingsProviderLabel(provider)} key from the AI provider settings.`}{" "}
              Documents must be re-indexed before they match queries with a new model.
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={saveMutation.isPending}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saveMutation.isPending || !canSave}>
              {saveMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
