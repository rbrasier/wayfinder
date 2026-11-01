"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConnectivityTest, type ConnectivityController } from "@/components/settings/connectivity";
import { SessionPolicyDialog } from "@/components/settings/session-policy-dialog";
import { trpc } from "@/trpc/client";

// Named once so the card, the wizard and the E2E spec agree on what an operator
// is looking at when a probe fails.
export const AUTH_METHOD_LABELS = {
  emailPassword: "Email + Password",
  entra: "Microsoft Entra ID",
  pki: "PKI client certificates",
} as const;

export function AuthMethodsCard({ connectivity }: { connectivity?: ConnectivityController }) {
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
  const [sessionPolicyOpen, setSessionPolicyOpen] = useState(false);
  const [emailPasswordEnabled, setEmailPasswordEnabled] = useState(true);
  const [entraEnabled, setEntraEnabled] = useState(false);
  const [pkiEnabled, setPkiEnabled] = useState(false);
  const [tenantId, setTenantId] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");

  const config = configQuery.data;
  // The environment holds PKI's precondition and the database holds the switch,
  // so the row can be enabled, disabled-because-ungated, or off (ADR-042 §1).
  const pkiEnvConfigured = config?.pki.envConfigured ?? false;

  useEffect(() => {
    if (!open || !config) return;
    setEmailPasswordEnabled(config.emailPasswordEnabled);
    setEntraEnabled(config.entraEnabled);
    setPkiEnabled(config.pkiEnabled);
    setTenantId(config.entra.tenantId);
    setClientId(config.entra.clientId);
    setClientSecret("");
  }, [open, config]);

  const handleSave = () => {
    // The server enforces this too — a client-side check only saves a round trip
    // and gives a faster message.
    if (!emailPasswordEnabled && !entraEnabled && !(pkiEnabled && pkiEnvConfigured)) {
      toast.error("At least one usable sign-in method must stay enabled");
      return;
    }
    saveMutation.mutate({
      emailPasswordEnabled,
      entraEnabled,
      pkiEnabled,
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
        <div className="flex items-center gap-2">
          {/* Session lifetime is part of how sign-in behaves, so it lives behind
              this card rather than as a card of its own (ADR-035). */}
          <Button
            size="sm"
            variant="outline"
            data-testid="session-policy-open"
            onClick={() => setSessionPolicyOpen(true)}
          >
            Set session policies
          </Button>
          <Button
            size="sm"
            variant="outline"
            data-testid="auth-methods-edit"
            onClick={() => setOpen(true)}
            disabled={!config}
          >
            Edit
          </Button>
        </div>
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
            <div className="flex justify-between" data-testid="auth-summary-pki">
              <span className="text-muted-foreground">{AUTH_METHOD_LABELS.pki}</span>
              <span className="font-medium">{config.pkiEnabled ? "On" : "Off"}</span>
            </div>
            {config.pkiEnabled && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Certificate session length</span>
                <span className="font-mono text-xs">{config.pki.sessionTtlHours} hours</span>
              </div>
            )}
            {connectivity && (
              <div className="space-y-2 pt-1">
                {config.emailPasswordEnabled && (
                  <ConnectivityTest
                    target="auth-email-password"
                    controller={connectivity}
                    label={AUTH_METHOD_LABELS.emailPassword}
                  />
                )}
                {config.entraEnabled && (
                  <ConnectivityTest
                    target="auth-entra"
                    controller={connectivity}
                    label={AUTH_METHOD_LABELS.entra}
                  />
                )}
                {config.pkiEnabled && (
                  <ConnectivityTest
                    target="auth-pki"
                    controller={connectivity}
                    label={AUTH_METHOD_LABELS.pki}
                  />
                )}
              </div>
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

            <div className="flex items-start justify-between gap-4" data-testid="auth-pki-row">
              <div className="space-y-1">
                <Label htmlFor="auth-pki">{AUTH_METHOD_LABELS.pki}</Label>
                <p className="text-xs text-muted-foreground">
                  {pkiEnvConfigured
                    ? "Lets users sign in with a smart card or client certificate issued by your organisation."
                    : "Requires PKI_TRUSTED_PROXY_IPS to be set in the environment before this can be enabled."}
                </p>
              </div>
              <input
                id="auth-pki"
                type="checkbox"
                className="mt-1 h-4 w-4 shrink-0"
                checked={pkiEnabled}
                disabled={!pkiEnvConfigured}
                data-testid="auth-pki-checkbox"
                onChange={(e) => setPkiEnabled(e.target.checked)}
              />
            </div>

            {entraEnabled && (
              <>
                <hr className="border-[#e7e3db]" />
                <p className="rounded-md border border-[#e7e3db] bg-[#faf9f7] p-3 text-xs text-muted-foreground">
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

      <SessionPolicyDialog open={sessionPolicyOpen} onOpenChange={setSessionPolicyOpen} />
    </Card>
  );
}
