"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/trpc/client";

const BYTES_PER_MB = 1024 * 1024;

type SizeLimitKey =
  | "sampleMaxDocuments"
  | "maxAnalyseDocuments"
  | "summaryRecordCap"
  | "contextBudgetTokens"
  | "maxPromptTokens";

// The size limits that were hardcoded until issue #335. Each is a positive
// whole number, so they share one input, one display row and one check.
const SIZE_LIMITS: { key: SizeLimitKey; label: string; help: string; placeholder: string }[] = [
  {
    key: "sampleMaxDocuments",
    label: "Sample size (documents)",
    help: "How many documents a sample run reads before it pauses for review.",
    placeholder: "3",
  },
  {
    key: "maxAnalyseDocuments",
    label: "Auto Analyse maximum (documents)",
    help: "The most documents an author can ask Auto Analyse to read when proposing fields.",
    placeholder: "10",
  },
  {
    key: "summaryRecordCap",
    label: "Run summary record cap",
    help: "The run summary reads this many records; it says so when a run has more.",
    placeholder: "50",
  },
  {
    key: "contextBudgetTokens",
    label: "Context material budget (tokens)",
    help: "Reference material beyond this is cut from every extraction prompt.",
    placeholder: "100000",
  },
  {
    key: "maxPromptTokens",
    label: "Max prompt per call (tokens)",
    help: "A document too large for one call is read in parts. Never exceeds the model's own window.",
    placeholder: "180000",
  },
];

const emptySizeLimits = (): Record<SizeLimitKey, string> => ({
  sampleMaxDocuments: "",
  maxAnalyseDocuments: "",
  summaryRecordCap: "",
  contextBudgetTokens: "",
  maxPromptTokens: "",
});
const toMb = (bytes: number): string => String(Math.round((bytes / BYTES_PER_MB) * 100) / 100);

// Admin config for the extraction batch engine (ADR-033): ingestion caps (the
// zip-bomb / oversize guards) and the per-run spend ceiling. Mirrors the
// Session Uploads card — an operator tunes these without a redeploy.
export function ExtractionConfigCard() {
  const utils = trpc.useUtils();
  const configQuery = trpc.settings.getExtractionConfig.useQuery();
  const saveMutation = trpc.settings.setExtractionConfig.useMutation({
    onSuccess: async () => {
      toast.success("Extraction limits saved");
      await utils.settings.getExtractionConfig.invalidate();
      setOpen(false);
    },
    onError: (error) => toast.error(error.message ?? "Failed to save extraction limits"),
  });

  const [open, setOpen] = useState(false);
  const [maxFiles, setMaxFiles] = useState("1000");
  const [maxEntries, setMaxEntries] = useState("500");
  const [maxEntryMb, setMaxEntryMb] = useState("25");
  const [maxTotalMb, setMaxTotalMb] = useState("500");
  const [costCeiling, setCostCeiling] = useState("0");
  const [sizeLimits, setSizeLimits] = useState(emptySizeLimits);

  const config = configQuery.data;

  useEffect(() => {
    if (!open || !config) return;
    setMaxFiles(String(config.maxFilesPerRun));
    setMaxEntries(String(config.maxArchiveEntries));
    setMaxEntryMb(toMb(config.maxArchiveEntryBytes));
    setMaxTotalMb(toMb(config.maxArchiveTotalBytes));
    setCostCeiling(String(config.perRunCostCeilingUsd));
    setSizeLimits({
      sampleMaxDocuments: String(config.sampleMaxDocuments),
      maxAnalyseDocuments: String(config.maxAnalyseDocuments),
      summaryRecordCap: String(config.summaryRecordCap),
      contextBudgetTokens: String(config.contextBudgetTokens),
      maxPromptTokens: String(config.maxPromptTokens),
    });
  }, [open, config]);

  const handleSave = () => {
    const files = Number(maxFiles);
    const entries = Number(maxEntries);
    const entryMb = Number(maxEntryMb);
    const totalMb = Number(maxTotalMb);
    const ceiling = Number(costCeiling);

    if (![files, entries].every((value) => Number.isInteger(value) && value > 0)) {
      toast.error("File and entry limits must be positive whole numbers");
      return;
    }
    if (![entryMb, totalMb].every((value) => Number.isFinite(value) && value > 0)) {
      toast.error("Size limits must be positive numbers of MB");
      return;
    }
    if (!Number.isFinite(ceiling) || ceiling < 0) {
      toast.error("Cost ceiling must be zero or a positive amount");
      return;
    }
    const parsedSizeLimits = {
      sampleMaxDocuments: Number(sizeLimits.sampleMaxDocuments),
      maxAnalyseDocuments: Number(sizeLimits.maxAnalyseDocuments),
      summaryRecordCap: Number(sizeLimits.summaryRecordCap),
      contextBudgetTokens: Number(sizeLimits.contextBudgetTokens),
      maxPromptTokens: Number(sizeLimits.maxPromptTokens),
    };
    if (!Object.values(parsedSizeLimits).every((value) => Number.isInteger(value) && value > 0)) {
      toast.error("Size limits must be positive whole numbers");
      return;
    }

    saveMutation.mutate({
      ...parsedSizeLimits,
      maxFilesPerRun: files,
      maxArchiveEntries: entries,
      maxArchiveEntryBytes: Math.round(entryMb * BYTES_PER_MB),
      maxArchiveTotalBytes: Math.round(totalMb * BYTES_PER_MB),
      perRunCostCeilingUsd: ceiling,
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Synthesise Information</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={!config}>
          Edit
        </Button>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground">
          Ingestion safety caps, the per-run spend ceiling and the size limits for extraction runs.
        </p>
        {!config ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Max files per run</span>
              <span className="font-mono text-xs">{config.maxFilesPerRun.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Max zip entries</span>
              <span className="font-mono text-xs">{config.maxArchiveEntries.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Max entry / total size</span>
              <span className="font-mono text-xs">
                {(config.maxArchiveEntryBytes / BYTES_PER_MB).toLocaleString()} /{" "}
                {(config.maxArchiveTotalBytes / BYTES_PER_MB).toLocaleString()} MB
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Per-run cost ceiling</span>
              <span className="font-mono text-xs">
                {config.perRunCostCeilingUsd > 0
                  ? `$${config.perRunCostCeilingUsd.toFixed(2)}`
                  : "None"}
              </span>
            </div>
            {SIZE_LIMITS.map((limit) => (
              <div key={limit.key} className="flex justify-between">
                <span className="text-muted-foreground">{limit.label}</span>
                <span className="font-mono text-xs">{config[limit.key].toLocaleString()}</span>
              </div>
            ))}
          </>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit extraction limits</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody className="max-h-[70vh] space-y-4 overflow-y-auto">
            <div className="space-y-1">
              <Label htmlFor="extraction-max-files">Max files per run</Label>
              <p className="text-xs text-muted-foreground">
                A run with more input files than this is rejected before it starts.
              </p>
              <Input
                id="extraction-max-files"
                value={maxFiles}
                onChange={(e) => setMaxFiles(e.target.value)}
                placeholder="1000"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="extraction-max-entries">Max zip entries</Label>
              <p className="text-xs text-muted-foreground">
                An uploaded zip with more files than this is rejected (zip-bomb guard).
              </p>
              <Input
                id="extraction-max-entries"
                value={maxEntries}
                onChange={(e) => setMaxEntries(e.target.value)}
                placeholder="500"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="extraction-max-entry-mb">Max entry size (MB)</Label>
              <p className="text-xs text-muted-foreground">
                A single file inside a zip larger than this is rejected.
              </p>
              <Input
                id="extraction-max-entry-mb"
                value={maxEntryMb}
                onChange={(e) => setMaxEntryMb(e.target.value)}
                placeholder="25"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="extraction-max-total-mb">Max total decompressed size (MB)</Label>
              <p className="text-xs text-muted-foreground">
                A zip that expands past this total is rejected (decompression-bomb guard).
              </p>
              <Input
                id="extraction-max-total-mb"
                value={maxTotalMb}
                onChange={(e) => setMaxTotalMb(e.target.value)}
                placeholder="500"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="extraction-cost-ceiling">Per-run cost ceiling (USD)</Label>
              <p className="text-xs text-muted-foreground">
                A run that reaches this accrued spend pauses cleanly. Zero disables the ceiling.
              </p>
              <Input
                id="extraction-cost-ceiling"
                value={costCeiling}
                onChange={(e) => setCostCeiling(e.target.value)}
                placeholder="0"
              />
            </div>
            {SIZE_LIMITS.map((limit) => (
              <div key={limit.key} className="space-y-1">
                <Label htmlFor={`extraction-${limit.key}`}>{limit.label}</Label>
                <p className="text-xs text-muted-foreground">{limit.help}</p>
                <Input
                  id={`extraction-${limit.key}`}
                  value={sizeLimits[limit.key]}
                  onChange={(e) => setSizeLimits((current) => ({ ...current, [limit.key]: e.target.value }))}
                  placeholder={limit.placeholder}
                />
              </div>
            ))}
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
