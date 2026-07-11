"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/trpc/client";
import { ConnectivityTest, type ConnectivityController } from "./connectivity";

export function StorageCard({ connectivity }: { connectivity: ConnectivityController }) {
  const utils = trpc.useUtils();
  const storageQuery = trpc.settings.getStorageConfig.useQuery();
  const saveMutation = trpc.settings.setStorageConfig.useMutation({
    onSuccess: async () => {
      toast.success("Storage configuration saved");
      await utils.settings.getStorageConfig.invalidate();
      setOpen(false);
    },
    onError: (error) => toast.error(error.message ?? "Failed to save storage configuration"),
  });

  const [open, setOpen] = useState(false);
  const [endpoint, setEndpoint] = useState("");
  const [port, setPort] = useState("9000");
  const [useSSL, setUseSSL] = useState(false);
  const [accessKey, setAccessKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [bucket, setBucket] = useState("");

  const config = storageQuery.data;

  useEffect(() => {
    if (!open || !config) return;
    setEndpoint(config.endpoint);
    setPort(String(config.port));
    setUseSSL(config.useSSL);
    setAccessKey(config.accessKey);
    setSecretKey("");
    setBucket(config.bucket);
  }, [open, config]);

  const handleSave = () => {
    const portNumber = Number(port);
    if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
      toast.error("Port must be a number between 1 and 65535");
      return;
    }
    if (!secretKey) {
      toast.error("Secret key is required");
      return;
    }
    saveMutation.mutate({
      endpoint: endpoint.trim(),
      port: portNumber,
      useSSL,
      accessKey: accessKey.trim(),
      secretKey,
      bucket: bucket.trim(),
    });
  };

  const url = useMemo(() => {
    if (!config) return "";
    const scheme = config.useSSL ? "https" : "http";
    return `${scheme}://${config.endpoint}:${config.port}/${config.bucket}`;
  }, [config]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Object Storage (S3 / MinIO)</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={!config}>
          Edit
        </Button>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {!config ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Bucket URL</span>
              <span className="font-mono text-xs">{url}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Access key</span>
              <span className="font-mono text-xs">{config.accessKey}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Secret key</span>
              <span className="font-mono text-xs">{config.secretKey || "—"}</span>
            </div>
          </>
        )}
        {config && Boolean(config.endpoint && config.accessKey && config.secretKey && config.bucket) && (
          <ConnectivityTest target="storage" controller={connectivity} />
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit storage configuration</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Saved values override <code>.env</code> and apply on the next request after saving.
            </p>
            <div className="space-y-1">
              <Label htmlFor="storage-endpoint">Endpoint host</Label>
              <Input
                id="storage-endpoint"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder="s3.amazonaws.com or localhost"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="storage-port">Port</Label>
                <Input
                  id="storage-port"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  placeholder="9000"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="storage-ssl">Use SSL</Label>
                <select
                  id="storage-ssl"
                  value={useSSL ? "true" : "false"}
                  onChange={(e) => setUseSSL(e.target.value === "true")}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="false">No (http)</option>
                  <option value="true">Yes (https)</option>
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="storage-bucket">Bucket</Label>
              <Input id="storage-bucket" value={bucket} onChange={(e) => setBucket(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="storage-access">Access key</Label>
              <Input id="storage-access" value={accessKey} onChange={(e) => setAccessKey(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="storage-secret">Secret key</Label>
              <Input
                id="storage-secret"
                type="password"
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
                placeholder="Required on each save"
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
