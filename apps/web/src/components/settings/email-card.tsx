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

type EmailProviderChoice = "smtp" | "m365";

const EMAIL_PROVIDER_LABEL: Record<EmailProviderChoice, string> = {
  smtp: "SMTP",
  m365: "Microsoft 365",
};

export function EmailCard({ connectivity }: { connectivity: ConnectivityController }) {
  const utils = trpc.useUtils();
  const configQuery = trpc.settings.getEmailConfig.useQuery();
  const saveMutation = trpc.settings.setEmailConfig.useMutation({
    onSuccess: async () => {
      toast.success("Email settings saved");
      await utils.settings.getEmailConfig.invalidate();
      setOpen(false);
    },
    onError: (error) => toast.error(error.message ?? "Failed to save email settings"),
  });
  const testMutation = trpc.settings.sendTestEmail.useMutation({
    onSuccess: () => toast.success("Test email sent"),
    onError: (error) => toast.error(error.message ?? "Failed to send test email"),
  });

  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<EmailProviderChoice>("smtp");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("587");
  const [secure, setSecure] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fromAddress, setFromAddress] = useState("");
  const [fromName, setFromName] = useState("");
  const [m365TenantId, setM365TenantId] = useState("");
  const [m365ClientId, setM365ClientId] = useState("");
  const [m365ClientSecret, setM365ClientSecret] = useState("");
  const [testTo, setTestTo] = useState("");

  const config = configQuery.data;
  const isConfigured = config
    ? config.provider === "m365"
      ? Boolean(config.m365TenantId && config.m365ClientId && config.fromAddress)
      : Boolean(config.host && config.username && config.fromAddress)
    : false;

  useEffect(() => {
    if (!open || !config) return;
    setProvider((config.provider as EmailProviderChoice) ?? "smtp");
    setHost(config.host);
    setPort(String(config.port));
    setSecure(config.secure);
    setUsername(config.username);
    setPassword("");
    setFromAddress(config.fromAddress);
    setFromName(config.fromName ?? "");
    setM365TenantId(config.m365TenantId ?? "");
    setM365ClientId(config.m365ClientId ?? "");
    setM365ClientSecret("");
  }, [open, config]);

  const handleSave = () => {
    if (fromAddress.trim() === "") {
      toast.error("From address is required");
      return;
    }
    const portNumber = Number(port);
    if (provider === "smtp") {
      if (!Number.isInteger(portNumber) || portNumber <= 0 || portNumber > 65535) {
        toast.error("Port must be a whole number between 1 and 65535");
        return;
      }
      if (host.trim() === "" || username.trim() === "") {
        toast.error("Host and username are required for SMTP");
        return;
      }
    } else if (m365TenantId.trim() === "" || m365ClientId.trim() === "") {
      toast.error("Tenant ID and client ID are required for Microsoft 365");
      return;
    }

    saveMutation.mutate({
      provider,
      host: host.trim(),
      port: Number.isInteger(portNumber) && portNumber > 0 ? portNumber : 587,
      secure,
      username: username.trim(),
      password: password.length > 0 ? password : null,
      fromAddress: fromAddress.trim(),
      fromName: fromName.trim().length > 0 ? fromName.trim() : null,
      m365TenantId: m365TenantId.trim(),
      m365ClientId: m365ClientId.trim(),
      m365ClientSecret: m365ClientSecret.length > 0 ? m365ClientSecret : null,
    });
  };

  const handleSendTest = () => {
    if (testTo.trim() === "") {
      toast.error("Enter an address to send the test to");
      return;
    }
    testMutation.mutate({ to: testTo.trim() });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Email</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={!config}>
          Edit
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Transport used to send outbound email from Wayfinder. Choose SMTP or Microsoft 365.
        </p>
        {!config ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : !isConfigured ? (
          <p className="text-muted-foreground">Not configured yet.</p>
        ) : (
          <>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Provider</span>
              <span className="font-medium">
                {EMAIL_PROVIDER_LABEL[config.provider as EmailProviderChoice] ?? config.provider}
              </span>
            </div>
            {config.provider === "m365" ? (
              <>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tenant</span>
                  <span className="font-mono text-xs">{config.m365TenantId || "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Client secret</span>
                  <span className="font-mono text-xs">
                    {config.m365ClientSecret === "set" ? "•••• set" : "unset"}
                  </span>
                </div>
              </>
            ) : (
              <>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">SMTP host</span>
                  <span className="font-mono text-xs">
                    {config.host}:{config.port}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Password</span>
                  <span className="font-mono text-xs">
                    {config.password === "set" ? "•••• set" : "unset"}
                  </span>
                </div>
              </>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">From</span>
              <span className="font-mono text-xs">{config.fromAddress}</span>
            </div>
          </>
        )}

        {isConfigured && (
          <div className="flex items-end gap-2 border-t border-[#ece9e3] pt-3">
            <div className="flex-1 space-y-1">
              <Label htmlFor="email-test-to">Send a test email to</Label>
              <Input
                id="email-test-to"
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
                placeholder="you@example.com"
              />
            </div>
            <Button variant="secondary" onClick={handleSendTest} disabled={testMutation.isPending}>
              {testMutation.isPending ? "Sending…" : "Send test"}
            </Button>
          </div>
        )}

        {isConfigured && <ConnectivityTest target="email" controller={connectivity} />}
      </CardContent>

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit email settings</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody className="max-h-[70vh] space-y-4 overflow-y-auto">
            <div className="space-y-1">
              <Label htmlFor="email-provider">Provider</Label>
              <select
                id="email-provider"
                value={provider}
                onChange={(e) => setProvider(e.target.value as EmailProviderChoice)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="smtp">SMTP</option>
                <option value="m365">Microsoft 365</option>
              </select>
            </div>

            {provider === "smtp" ? (
              <>
                <div className="space-y-1">
                  <Label htmlFor="email-host">SMTP host</Label>
                  <Input id="email-host" value={host} onChange={(e) => setHost(e.target.value)} placeholder="smtp.example.com" />
                </div>
                <div className="flex gap-3">
                  <div className="flex-1 space-y-1">
                    <Label htmlFor="email-port">Port</Label>
                    <Input id="email-port" value={port} onChange={(e) => setPort(e.target.value)} placeholder="587" />
                  </div>
                  <div className="flex items-center gap-2 pt-6">
                    <input
                      id="email-secure"
                      type="checkbox"
                      checked={secure}
                      onChange={(e) => setSecure(e.target.checked)}
                      className="h-4 w-4"
                    />
                    <Label htmlFor="email-secure">Use TLS/SSL</Label>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="email-username">Username</Label>
                  <Input id="email-username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="apikey" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="email-password">Password</Label>
                  <p className="text-xs text-muted-foreground">Leave blank to keep the stored password.</p>
                  <Input
                    id="email-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={config?.password === "set" ? "•••••• (unchanged)" : ""}
                  />
                </div>
              </>
            ) : (
              <>
                <p className="rounded-md border border-[#dedad2] bg-[#f7f6f3] p-3 text-xs text-muted-foreground">
                  Sends via Exchange Online using a Microsoft 365 app registration
                  (client-credentials OAuth2). Grant the app the <code>SMTP.SendAsApp</code> /
                  mail send permission and admin consent. Mail is sent as the mailbox below.
                </p>
                <div className="space-y-1">
                  <Label htmlFor="email-m365-tenant">Tenant ID</Label>
                  <Input id="email-m365-tenant" value={m365TenantId} onChange={(e) => setM365TenantId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="email-m365-client">Client ID</Label>
                  <Input id="email-m365-client" value={m365ClientId} onChange={(e) => setM365ClientId(e.target.value)} placeholder="Application (client) ID" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="email-m365-secret">Client secret</Label>
                  <p className="text-xs text-muted-foreground">Leave blank to keep the stored secret.</p>
                  <Input
                    id="email-m365-secret"
                    type="password"
                    value={m365ClientSecret}
                    onChange={(e) => setM365ClientSecret(e.target.value)}
                    placeholder={config?.m365ClientSecret === "set" ? "•••••• (unchanged)" : ""}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="email-m365-mailbox">Sender mailbox (optional)</Label>
                  <p className="text-xs text-muted-foreground">
                    Defaults to the from address. Set if sending as a different mailbox (UPN).
                  </p>
                  <Input id="email-m365-mailbox" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="no-reply@yourtenant.onmicrosoft.com" />
                </div>
              </>
            )}

            <div className="space-y-1">
              <Label htmlFor="email-from-address">From address</Label>
              <Input id="email-from-address" value={fromAddress} onChange={(e) => setFromAddress(e.target.value)} placeholder="no-reply@example.com" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="email-from-name">From name (optional)</Label>
              <Input id="email-from-name" value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Wayfinder" />
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
