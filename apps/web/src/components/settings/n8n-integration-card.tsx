"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/trpc/client";
import { ConnectivityTest, type ConnectivityController } from "./connectivity";

export function N8nIntegrationCard({ connectivity }: { connectivity: ConnectivityController }) {
  const utils = trpc.useUtils();
  const configQuery = trpc.settings.getN8nConfig.useQuery();
  const saveMutation = trpc.settings.setN8nConfig.useMutation({
    onSuccess: async () => {
      toast.success("n8n settings saved");
      await utils.settings.getN8nConfig.invalidate();
      setOpen(false);
    },
    onError: (error) => toast.error(error.message ?? "Failed to save n8n settings"),
  });

  const [open, setOpen] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");

  const config = configQuery.data;

  useEffect(() => {
    if (!open || !config) return;
    setBaseUrl(config.baseUrl);
    setApiKey("");
  }, [open, config]);

  const handleSave = () => {
    if (baseUrl.trim() === "") {
      toast.error("Base URL is required");
      return;
    }
    saveMutation.mutate({ baseUrl: baseUrl.trim(), apiKey: apiKey.length > 0 ? apiKey : null });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">n8n Integration</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={!config}>
          Edit
        </Button>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground">
          Connect an n8n instance so auto nodes can pick from your workflows instead of
          hand-typing a webhook URL.
        </p>
        {!config ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Base URL</span>
              <span className="font-mono text-xs">{config.baseUrl || "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">API key</span>
              <span className="font-mono text-xs">{config.apiKey === "set" ? "•••• set" : "unset"}</span>
            </div>
          </>
        )}
        {config && Boolean(config.baseUrl) && config.apiKey === "set" && (
          <ConnectivityTest target="n8n" controller={connectivity} />
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit n8n settings</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Saved values override <code>.env</code>. Leave the API key blank to keep the stored one.
            </p>
            <div className="space-y-1">
              <Label htmlFor="n8n-base-url">Base URL</Label>
              <Input
                id="n8n-base-url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://n8n.example.com"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="n8n-api-key">API key</Label>
              <Input
                id="n8n-api-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={config?.apiKey === "set" ? "•••••• (stored)" : "Not set"}
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
