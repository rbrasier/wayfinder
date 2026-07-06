"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/trpc/client";

export function AuthMethodsCard() {
  const utils = trpc.useUtils();
  const configQuery = trpc.settings.getAuthConfig.useQuery();
  const saveMutation = trpc.settings.setAuthConfig.useMutation({
    onSuccess: async () => {
      toast.success("Authentication settings saved");
      await utils.settings.getAuthConfig.invalidate();
      await utils.settings.enabledAuthMethods.invalidate();
      setOpen(false);
    },
    onError: (error) => toast.error(error.message ?? "Failed to save authentication settings"),
  });

  const [open, setOpen] = useState(false);
  const [emailPasswordEnabled, setEmailPasswordEnabled] = useState(true);
  const [entraEnabled, setEntraEnabled] = useState(false);
  const [tenantId, setTenantId] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");

  const config = configQuery.data;

  useEffect(() => {
    if (!open || !config) return;
    setEmailPasswordEnabled(config.emailPasswordEnabled);
    setEntraEnabled(config.entraEnabled);
    setTenantId(config.entra.tenantId);
    setClientId(config.entra.clientId);
    setClientSecret("");
  }, [open, config]);

  const handleSave = () => {
    if (!emailPasswordEnabled && !entraEnabled) {
      toast.error("At least one sign-in method must stay enabled");
      return;
    }
    saveMutation.mutate({
      emailPasswordEnabled,
      entraEnabled,
      entra: {
        tenantId: tenantId.trim(),
        clientId: clientId.trim(),
        clientSecret: clientSecret.length > 0 ? clientSecret : null,
      },
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Authentication</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={!config}>
          Edit
        </Button>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground">
          Choose which sign-in methods staff may use. Changes apply on the next request — no
          redeploy needed.
        </p>
        {!config ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Email + Password</span>
              <span className="font-medium">{config.emailPasswordEnabled ? "On" : "Off"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Microsoft Entra ID</span>
              <span className="font-medium">{config.entraEnabled ? "On" : "Off"}</span>
            </div>
            {config.entraEnabled && (
              <>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tenant</span>
                  <span className="font-mono text-xs">{config.entra.tenantId || "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Client secret</span>
                  <span className="font-mono text-xs">
                    {config.entra.clientSecret === "set" ? "•••• set" : "unset"}
                  </span>
                </div>
              </>
            )}
          </>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit authentication settings</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody className="max-h-[70vh] space-y-4 overflow-y-auto">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <Label htmlFor="auth-email-password">Email + Password</Label>
                <p className="text-xs text-muted-foreground">
                  Lets users sign in with an email address and password.
                </p>
              </div>
              <input
                id="auth-email-password"
                type="checkbox"
                className="mt-1 h-4 w-4 shrink-0"
                checked={emailPasswordEnabled}
                onChange={(e) => setEmailPasswordEnabled(e.target.checked)}
              />
            </div>

            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <Label htmlFor="auth-entra">Microsoft Entra ID</Label>
                <p className="text-xs text-muted-foreground">
                  Lets users sign in with their Microsoft work account.
                </p>
              </div>
              <input
                id="auth-entra"
                type="checkbox"
                className="mt-1 h-4 w-4 shrink-0"
                checked={entraEnabled}
                onChange={(e) => setEntraEnabled(e.target.checked)}
              />
            </div>

            {entraEnabled && (
              <>
                <hr className="border-[#dedad2]" />
                <p className="rounded-md border border-[#dedad2] bg-[#f7f6f3] p-3 text-xs text-muted-foreground">
                  Create an app registration in the Azure portal and paste the redirect URI below
                  into its <code>Web</code> platform redirect URIs.
                </p>
                <div className="space-y-1">
                  <Label htmlFor="auth-entra-redirect">Redirect URI (read-only)</Label>
                  <Input
                    id="auth-entra-redirect"
                    value={config?.redirectUri ?? ""}
                    readOnly
                    className="font-mono text-xs"
                    onFocus={(e) => e.currentTarget.select()}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="auth-entra-tenant">Tenant ID</Label>
                  <Input
                    id="auth-entra-tenant"
                    value={tenantId}
                    onChange={(e) => setTenantId(e.target.value)}
                    placeholder="00000000-0000-0000-0000-000000000000"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="auth-entra-client">Client ID</Label>
                  <Input
                    id="auth-entra-client"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    placeholder="Application (client) ID"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="auth-entra-secret">Client secret</Label>
                  <p className="text-xs text-muted-foreground">Leave blank to keep the stored secret.</p>
                  <Input
                    id="auth-entra-secret"
                    type="password"
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                    placeholder={config?.entra.clientSecret === "set" ? "•••••• (unchanged)" : ""}
                  />
                </div>
              </>
            )}
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
