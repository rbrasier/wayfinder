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

type CredentialSource = "email" | "auth" | "own";

// Named once so the card and the modal agree on what an operator is choosing
// between, and on what each choice inherits.
const CREDENTIAL_SOURCES: { value: CredentialSource; label: string; description: string }[] = [
  {
    value: "email",
    label: "Reuse the email app registration",
    description: "The Microsoft 365 app registration configured on the Email card.",
  },
  {
    value: "auth",
    label: "Reuse the sign-in app registration",
    description: "The Microsoft Entra ID app registration configured on the Authentication card.",
  },
  {
    value: "own",
    label: "Enter separate credentials",
    description: "For a tenant that issues a distinct app registration for directory reads.",
  },
];

const SOURCE_LABELS: Record<CredentialSource, string> = {
  email: "Email app registration",
  auth: "Sign-in app registration",
  own: "Separate credentials",
};

export function EntraDirectoryCard({ connectivity }: { connectivity: ConnectivityController }) {
  const utils = trpc.useUtils();
  const configQuery = trpc.settings.getDirectoryConfig.useQuery();
  const saveMutation = trpc.settings.setDirectoryConfig.useMutation({
    onSuccess: async () => {
      toast.success("Approver directory settings saved");
      await utils.settings.getDirectoryConfig.invalidate();
      setOpen(false);
    },
    onError: (error) => toast.error(error.message ?? "Failed to save approver directory settings"),
  });

  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [credentialSource, setCredentialSource] = useState<CredentialSource>("email");
  const [tenantId, setTenantId] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");

  const config = configQuery.data;

  useEffect(() => {
    if (!open || !config) return;
    setEnabled(config.enabled);
    setCredentialSource(config.credentialSource);
    setTenantId(config.entra.tenantId);
    setClientId(config.entra.clientId);
    setClientSecret("");
  }, [open, config]);

  const handleSave = () => {
    saveMutation.mutate({
      enabled,
      credentialSource,
      entra: {
        tenantId: tenantId.trim(),
        clientId: clientId.trim(),
        clientSecret: clientSecret.length > 0 ? clientSecret : null,
      },
    });
  };

  const sourceConfigured = (source: CredentialSource): boolean => {
    if (!config) return false;
    if (source === "own") return config.entra.clientSecret === "set";
    return config.sources[source];
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Approver Directory (Microsoft Entra)</CardTitle>
        <Button
          size="sm"
          variant="outline"
          data-testid="directory-edit"
          onClick={() => setOpen(true)}
          disabled={!config}
        >
          Edit
        </Button>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground">
          Resolves first- and second-level approvers from your tenant&apos;s reporting line, and
          searches people by name. Changes apply on the next request — no redeploy needed.
        </p>
        {!config ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Directory lookups</span>
              <span className="font-medium">{config.enabled ? "On" : "Off"}</span>
            </div>
            {config.enabled && (
              <>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Credentials</span>
                  <span className="font-medium">{SOURCE_LABELS[config.credentialSource]}</span>
                </div>
                {config.credentialSource === "own" && (
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
                {!config.resolves && (
                  <p className="text-muted-foreground">
                    Switched on, but the chosen credentials are incomplete — resolution is falling
                    back to the HR upload and manual pick.
                  </p>
                )}
              </>
            )}
            <p className="text-muted-foreground">
              The app registration needs the Graph application permissions{" "}
              <code>User.Read.All</code> and <code>Directory.Read.All</code>, with tenant admin
              consent. Until those are granted, resolution falls back to the HR upload and manual
              pick.
            </p>
            <ConnectivityTest target="entra" controller={connectivity} />
          </>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit approver directory settings</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody className="max-h-[70vh] space-y-4 overflow-y-auto">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <Label htmlFor="directory-enabled">Look approvers up in Microsoft Entra</Label>
                <p className="text-xs text-muted-foreground">
                  Off, approvers come from the HR upload and manual pick only.
                </p>
              </div>
              <input
                id="directory-enabled"
                type="checkbox"
                className="mt-1 h-4 w-4 shrink-0"
                data-testid="directory-enabled"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
            </div>

            {enabled && (
              <>
                <hr className="border-[#e7e3db]" />
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">Credentials</legend>
                  {CREDENTIAL_SOURCES.map((source) => (
                    <div key={source.value} className="flex items-start gap-3">
                      <input
                        id={`directory-source-${source.value}`}
                        type="radio"
                        name="directory-source"
                        className="mt-1 h-4 w-4 shrink-0"
                        checked={credentialSource === source.value}
                        onChange={() => setCredentialSource(source.value)}
                      />
                      <div className="space-y-0.5">
                        <Label htmlFor={`directory-source-${source.value}`}>{source.label}</Label>
                        <p className="text-xs text-muted-foreground">
                          {source.description}
                          {!sourceConfigured(source.value) && " Not configured yet."}
                        </p>
                      </div>
                    </div>
                  ))}
                </fieldset>
              </>
            )}

            {enabled && credentialSource === "own" && (
              <>
                <hr className="border-[#e7e3db]" />
                <p className="rounded-md border border-[#e7e3db] bg-[#faf9f7] p-3 text-xs text-muted-foreground">
                  Grant this app registration the Graph application permissions{" "}
                  <code>User.Read.All</code> and <code>Directory.Read.All</code>, then have a
                  tenant admin consent to them.
                </p>
                <div className="space-y-1">
                  <Label htmlFor="directory-tenant">Tenant ID</Label>
                  <Input
                    id="directory-tenant"
                    value={tenantId}
                    onChange={(e) => setTenantId(e.target.value)}
                    placeholder="00000000-0000-0000-0000-000000000000"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="directory-client">Client ID</Label>
                  <Input
                    id="directory-client"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    placeholder="Application (client) ID"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="directory-secret">Client secret</Label>
                  <p className="text-xs text-muted-foreground">
                    Leave blank to keep the stored secret.
                  </p>
                  <Input
                    id="directory-secret"
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
