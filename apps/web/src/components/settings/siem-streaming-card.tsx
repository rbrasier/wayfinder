"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/trpc/client";

type SiemFormat = "json" | "cef";

export function SiemStreamingCard() {
  const utils = trpc.useUtils();
  const configQuery = trpc.settings.getSiemConfig.useQuery();
  const saveMutation = trpc.settings.setSiemConfig.useMutation({
    onSuccess: async () => {
      toast.success("SIEM streaming saved");
      await utils.settings.getSiemConfig.invalidate();
      setOpen(false);
    },
    onError: (error) => toast.error(error.message ?? "Failed to save SIEM config"),
  });

  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [endpoint, setEndpoint] = useState("");
  const [format, setFormat] = useState<SiemFormat>("json");
  const [token, setToken] = useState("");

  const config = configQuery.data;

  useEffect(() => {
    if (!open || !config) return;
    setEnabled(config.enabled);
    setEndpoint(config.endpoint);
    setFormat(config.format);
    setToken("");
  }, [open, config]);

  const handleSave = () => {
    saveMutation.mutate({
      enabled,
      endpoint,
      format,
      // Blank keeps the stored token (never read back).
      token: token.length > 0 ? token : null,
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">SIEM streaming</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={!config}>
          Edit
        </Button>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground">
          Forward audit events to an external SIEM (Splunk, Microsoft Sentinel) after they are
          recorded. Best-effort: a delivery failure never blocks the audit write.
        </p>
        {!config ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Status</span>
              <span className="font-medium">{config.enabled ? "On" : "Off"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Endpoint</span>
              <span className="font-medium">{config.endpoint || "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Format</span>
              <span className="font-medium uppercase">{config.format}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Token</span>
              <span className="font-medium">{config.token === "set" ? "Set" : "Not set"}</span>
            </div>
          </>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && setOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>SIEM streaming</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody className="space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <Label htmlFor="siem-enabled">Enabled</Label>
                <p className="text-xs text-muted-foreground">Stream new audit events to the endpoint.</p>
              </div>
              <input
                id="siem-enabled"
                type="checkbox"
                className="mt-1 h-4 w-4 shrink-0"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="siem-endpoint">Endpoint URL</Label>
              <Input
                id="siem-endpoint"
                value={endpoint}
                placeholder="https://siem.example.com/services/collector"
                onChange={(event) => setEndpoint(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="siem-format">Format</Label>
              <select
                id="siem-format"
                className="flex w-full rounded-[9px] border border-[#dedad2] bg-[#f7f6f3] px-3 py-[9px] text-[13px]"
                value={format}
                onChange={(event) => setFormat(event.target.value as SiemFormat)}
              >
                <option value="json">JSON</option>
                <option value="cef">CEF</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="siem-token">Token</Label>
              <Input
                id="siem-token"
                type="password"
                value={token}
                placeholder={config?.token === "set" ? "•••••• (unchanged)" : "Bearer token"}
                onChange={(event) => setToken(event.target.value)}
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
