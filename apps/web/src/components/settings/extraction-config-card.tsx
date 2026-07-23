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

  const config = configQuery.data;

  useEffect(() => {
    if (!open || !config) return;
    setMaxFiles(String(config.maxFilesPerRun));
    setMaxEntries(String(config.maxArchiveEntries));
    setMaxEntryMb(toMb(config.maxArchiveEntryBytes));
    setMaxTotalMb(toMb(config.maxArchiveTotalBytes));
    setCostCeiling(String(config.perRunCostCeilingUsd));
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

    saveMutation.mutate({
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
          Ingestion safety caps and the per-run spend ceiling for extraction batch runs.
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
          </>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit extraction limits</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody className="space-y-4">
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
