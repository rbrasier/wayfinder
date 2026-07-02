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
import { ConnectivityTest, useConnectivity } from "@/components/admin/connectivity";

function N8nIntegrationCard() {
  const utils = trpc.useUtils();
  const connectivity = useConnectivity();
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

export default function AdminN8nPage() {
  const featureQuery = trpc.featureFlag.isEnabledForMe.useQuery({ key: "auto_node" });

  return (
    <div className="h-full overflow-auto">
      <div className="container py-8">
        <div className="space-y-6">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">n8n</h1>
            <p className="text-sm text-muted-foreground">
              Connect an n8n instance so automated (n8n) flow steps can call your workflows.
            </p>
          </div>
          {featureQuery.data === false ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">n8n unavailable</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Automated (n8n) nodes are turned off for your account. An administrator can enable
                  the <span className="font-mono">auto_node</span> feature flag to manage the n8n
                  connection here.
                </p>
              </CardContent>
            </Card>
          ) : (
            <N8nIntegrationCard />
          )}
        </div>
      </div>
    </div>
  );
}
