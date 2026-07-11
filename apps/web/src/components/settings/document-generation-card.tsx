"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/trpc/client";

type ContextBudgetMode = "tokens" | "model_percent";

export function DocumentGenerationCard() {
  const utils = trpc.useUtils();
  const configQuery = trpc.settings.getDocumentGenerationConfig.useQuery();
  const saveMutation = trpc.settings.setDocumentGenerationConfig.useMutation({
    onSuccess: async () => {
      toast.success("Document generation settings saved");
      await utils.settings.getDocumentGenerationConfig.invalidate();
      setOpen(false);
    },
    onError: (error) => toast.error(error.message ?? "Failed to save document generation settings"),
  });

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ContextBudgetMode>("tokens");
  const [contextBudgetTokens, setContextBudgetTokens] = useState("100000");
  const [contextBudgetPercent, setContextBudgetPercent] = useState("50");
  const [fieldBatchSize, setFieldBatchSize] = useState("12");
  const [maxPromptTokens, setMaxPromptTokens] = useState("180000");

  const data = configQuery.data;
  const config = data?.config;
  const model = data?.model;

  useEffect(() => {
    if (!open || !config) return;
    setMode(config.contextBudgetMode);
    setContextBudgetTokens(String(config.contextBudgetTokens));
    setContextBudgetPercent(String(config.contextBudgetPercent));
    setFieldBatchSize(String(config.fieldBatchSize));
    setMaxPromptTokens(String(config.maxPromptTokens));
  }, [open, config]);

  const handleSave = () => {
    const tokens = Number(contextBudgetTokens);
    const percent = Number(contextBudgetPercent);
    const batch = Number(fieldBatchSize);
    const maxPrompt = Number(maxPromptTokens);
    if (mode === "tokens" && (!Number.isInteger(tokens) || tokens <= 0)) {
      toast.error("Context budget tokens must be a positive whole number");
      return;
    }
    if (mode === "model_percent" && (!Number.isInteger(percent) || percent < 1 || percent > 100)) {
      toast.error("Context budget percent must be a whole number between 1 and 100");
      return;
    }
    if (!Number.isInteger(batch) || batch <= 0) {
      toast.error("Field batch size must be a positive whole number");
      return;
    }
    if (!Number.isInteger(maxPrompt) || maxPrompt <= 0) {
      toast.error("Max prompt tokens must be a positive whole number");
      return;
    }
    saveMutation.mutate({
      contextBudgetMode: mode,
      contextBudgetTokens: Number.isInteger(tokens) && tokens > 0 ? tokens : 100_000,
      contextBudgetPercent: Number.isInteger(percent) && percent >= 1 && percent <= 100 ? percent : 50,
      fieldBatchSize: batch,
      maxPromptTokens: maxPrompt,
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Document Generation</CardTitle>
        <Button
          size="sm"
          variant="outline"
          data-testid="document-generation-edit"
          onClick={() => setOpen(true)}
          disabled={!config}
        >
          Edit
        </Button>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground">
          Budgets that keep generated-document prompts under the model context window. Defaults match
          the built-in limits; raise or lower them for your model and document set.
        </p>
        {!config ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Context budget</span>
              <span className="font-mono text-xs">
                {config.contextBudgetMode === "model_percent"
                  ? `${config.contextBudgetPercent}% of model window`
                  : `${config.contextBudgetTokens.toLocaleString()} tokens`}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Field batch size</span>
              <span data-testid="document-generation-batch" className="font-mono text-xs">
                {config.fieldBatchSize}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Max prompt tokens</span>
              <span className="font-mono text-xs">{config.maxPromptTokens.toLocaleString()}</span>
            </div>
            {model && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Model context window</span>
                <span className="font-mono text-xs">
                  {model.contextWindowTokens.toLocaleString()} tokens
                  {model.estimated ? " (estimated)" : ""}
                </span>
              </div>
            )}
          </>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit document generation settings</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody className="space-y-4">
            {model && (
              <p className="rounded-md border border-[#dedad2] bg-[#f7f6f3] p-3 text-xs text-muted-foreground">
                Active model <code>{model.model}</code> has a context window of{" "}
                {model.contextWindowTokens.toLocaleString()} tokens
                {model.estimated ? " (estimated — model not in the known list)" : ""}.
              </p>
            )}
            <div className="space-y-1">
              <Label htmlFor="doc-gen-mode">Context budget mode</Label>
              <select
                id="doc-gen-mode"
                value={mode}
                onChange={(e) => setMode(e.target.value as ContextBudgetMode)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="tokens">Explicit token cap</option>
                <option value="model_percent">Percentage of model window</option>
              </select>
            </div>
            {mode === "tokens" ? (
              <div className="space-y-1">
                <Label htmlFor="doc-gen-tokens">Context budget (tokens)</Label>
                <p className="text-xs text-muted-foreground">
                  Maximum reference-document context fed into a single generation call.
                </p>
                <Input
                  id="doc-gen-tokens"
                  value={contextBudgetTokens}
                  onChange={(e) => setContextBudgetTokens(e.target.value)}
                  placeholder="100000"
                />
              </div>
            ) : (
              <div className="space-y-1">
                <Label htmlFor="doc-gen-percent">Context budget (% of model window)</Label>
                <p className="text-xs text-muted-foreground">
                  Share of the model&apos;s context window allotted to reference documents (1–100).
                </p>
                <Input
                  id="doc-gen-percent"
                  value={contextBudgetPercent}
                  onChange={(e) => setContextBudgetPercent(e.target.value)}
                  placeholder="50"
                />
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="doc-gen-batch">Field batch size</Label>
              <p className="text-xs text-muted-foreground">
                Template fields gathered per model call. Smaller keeps each prompt bounded.
              </p>
              <Input
                id="doc-gen-batch"
                value={fieldBatchSize}
                onChange={(e) => setFieldBatchSize(e.target.value)}
                placeholder="12"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="doc-gen-max-prompt">Max prompt tokens</Label>
              <p className="text-xs text-muted-foreground">
                A batch whose prompt would exceed this fails with a clear message instead of calling
                the model.
              </p>
              <Input
                id="doc-gen-max-prompt"
                value={maxPromptTokens}
                onChange={(e) => setMaxPromptTokens(e.target.value)}
                placeholder="180000"
              />
            </div>
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
