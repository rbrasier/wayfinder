"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/trpc/client";

export function SessionUploadsCard() {
  const utils = trpc.useUtils();
  const configQuery = trpc.settings.getSessionUploadConfig.useQuery();
  const saveMutation = trpc.settings.setSessionUploadConfig.useMutation({
    onSuccess: async () => {
      toast.success("Session upload limits saved");
      await utils.settings.getSessionUploadConfig.invalidate();
      setOpen(false);
    },
    onError: (error) => toast.error(error.message ?? "Failed to save session upload limits"),
  });

  const [open, setOpen] = useState(false);
  const [maxFileSizeMb, setMaxFileSizeMb] = useState("20");
  const [totalBudgetChars, setTotalBudgetChars] = useState("65536");

  const config = configQuery.data;

  useEffect(() => {
    if (!open || !config) return;
    setMaxFileSizeMb(String(Math.round((config.maxFileSizeBytes / (1024 * 1024)) * 100) / 100));
    setTotalBudgetChars(String(config.totalBudgetChars));
  }, [open, config]);

  const handleSave = () => {
    const megabytes = Number(maxFileSizeMb);
    const budget = Number(totalBudgetChars);
    if (!Number.isFinite(megabytes) || megabytes <= 0) {
      toast.error("Max file size must be a positive number of MB");
      return;
    }
    if (!Number.isInteger(budget) || budget <= 0) {
      toast.error("Total budget must be a positive whole number of characters");
      return;
    }
    saveMutation.mutate({
      maxFileSizeBytes: Math.round(megabytes * 1024 * 1024),
      totalBudgetChars: budget,
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Session Uploads</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={!config}>
          Edit
        </Button>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground">
          Limits for files end users attach mid-conversation to give the assistant extra context.
        </p>
        {!config ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Max file size</span>
              <span className="font-mono text-xs">
                {(config.maxFileSizeBytes / (1024 * 1024)).toLocaleString()} MB
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total context budget</span>
              <span className="font-mono text-xs">
                {config.totalBudgetChars.toLocaleString()} chars
              </span>
            </div>
          </>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit session upload limits</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="session-upload-max-size">Max file size (MB)</Label>
              <p className="text-xs text-muted-foreground">
                Files larger than this are rejected at upload.
              </p>
              <Input
                id="session-upload-max-size"
                value={maxFileSizeMb}
                onChange={(e) => setMaxFileSizeMb(e.target.value)}
                placeholder="20"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="session-upload-budget">Total context budget (characters)</Label>
              <p className="text-xs text-muted-foreground">
                Combined extracted-text limit across all uploads in a single session.
              </p>
              <Input
                id="session-upload-budget"
                value={totalBudgetChars}
                onChange={(e) => setTotalBudgetChars(e.target.value)}
                placeholder="65536"
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
