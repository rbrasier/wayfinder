"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { ConnectivityResult, ConnectivityTarget } from "@rbrasier/domain";
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
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/trpc/client";

type Provider = "anthropic" | "openai" | "mistral" | "bedrock";

const PROVIDER_LABEL: Record<Provider, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI",
  mistral: "Mistral",
  bedrock: "Amazon Bedrock",
};

// Targets exercised by the header "Test all" button, in card order.
const ALL_CONNECTIVITY_TARGETS: ConnectivityTarget[] = [
  "ai",
  "n8n",
  "embeddings",
  "storage",
  "email",
  "entra",
];

type BadgeState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "ok"; latencyMs?: number; message?: string }
  | { status: "skipped"; message?: string }
  | { status: "failed"; message?: string };

interface ConnectivityController {
  states: Partial<Record<ConnectivityTarget, BadgeState>>;
  runTest: (target: ConnectivityTarget) => Promise<void>;
  runAll: (targets: ConnectivityTarget[]) => Promise<void>;
  isBusy: boolean;
}

const toBadge = (result: ConnectivityResult): BadgeState => {
  if (result.skipped) return { status: "skipped", message: result.message };
  if (result.ok) return { status: "ok", latencyMs: result.latencyMs, message: result.message };
  return { status: "failed", message: result.message };
};

function useConnectivity(): ConnectivityController {
  const [states, setStates] = useState<Partial<Record<ConnectivityTarget, BadgeState>>>({});
  const mutation = trpc.settings.testConnectivity.useMutation();

  const runTest = useCallback(
    async (target: ConnectivityTarget) => {
      setStates((prev) => ({ ...prev, [target]: { status: "testing" } }));
      try {
        const result = await mutation.mutateAsync({ target });
        setStates((prev) => ({ ...prev, [target]: toBadge(result) }));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Probe failed";
        setStates((prev) => ({ ...prev, [target]: { status: "failed", message } }));
      }
    },
    [mutation],
  );

  // Fan out to per-card probes in parallel so each badge resolves independently.
  const runAll = useCallback(
    async (targets: ConnectivityTarget[]) => {
      await Promise.all(targets.map((target) => runTest(target)));
    },
    [runTest],
  );

  const isBusy = Object.values(states).some((state) => state?.status === "testing");

  return { states, runTest, runAll, isBusy };
}

function ConnectivityBadge({ target, state }: { target: ConnectivityTarget; state?: BadgeState }) {
  if (!state || state.status === "idle") return null;

  const testId = `connectivity-badge-${target}`;
  if (state.status === "testing") {
    return (
      <span
        data-testid={testId}
        data-status="testing"
        className="inline-flex items-center gap-1 rounded-md border border-[#dedad2] bg-[#f7f6f3] px-2 py-1 text-xs text-muted-foreground"
      >
        <span className="h-2 w-2 animate-pulse rounded-full bg-muted-foreground" /> Testing…
      </span>
    );
  }
  if (state.status === "ok") {
    return (
      <span
        data-testid={testId}
        data-status="ok"
        className="inline-flex rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs text-emerald-900"
      >
        Reachable{typeof state.latencyMs === "number" ? ` · ${state.latencyMs} ms` : ""}
      </span>
    );
  }
  if (state.status === "skipped") {
    return (
      <span
        data-testid={testId}
        data-status="skipped"
        className="inline-flex rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900"
      >
        {state.message ?? "Not configured"}
      </span>
    );
  }
  return (
    <span
      data-testid={testId}
      data-status="failed"
      className="inline-flex rounded-md border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-900"
    >
      Failed{state.message ? `: ${state.message}` : ""}
    </span>
  );
}

function ConnectivityTest({
  target,
  controller,
}: {
  target: ConnectivityTarget;
  controller: ConnectivityController;
}) {
  const state = controller.states[target];
  return (
    <div className="flex items-center gap-2 border-t border-[#ece9e3] pt-3">
      <Button
        size="sm"
        variant="secondary"
        data-testid={`test-connectivity-${target}`}
        onClick={() => void controller.runTest(target)}
        disabled={state?.status === "testing"}
      >
        {state?.status === "testing" ? "Testing…" : "Test connectivity"}
      </Button>
      <ConnectivityBadge target={target} state={state} />
    </div>
  );
}

function OrganisationNameCard() {
  const orgNameQuery = trpc.settings.get.useQuery({ key: "organisation_name" });
  const setMutation = trpc.settings.set.useMutation({
    onSuccess: () => toast.success("Organisation name saved"),
    onError: () => toast.error("Failed to save organisation name"),
  });

  const [value, setValue] = useState("");

  useEffect(() => {
    if (orgNameQuery.data?.value !== undefined) {
      setValue(orgNameQuery.data.value);
    }
  }, [orgNameQuery.data?.value]);

  const handleSave = () => {
    setMutation.mutate({ key: "organisation_name", value: value.trim() });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">General</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="org-name">Organisation name</Label>
          <p className="text-xs text-muted-foreground">
            Used in AI system prompts to give the assistant context about your organisation.
          </p>
          <Input
            id="org-name"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="e.g. Acme Legal"
            disabled={orgNameQuery.isLoading}
            // Password managers / autofill inject attributes (e.g. caret-color,
            // fdprocessedid) onto inputs after SSR, producing a benign dev-mode
            // hydration warning. Suppress it for this field only.
            suppressHydrationWarning
          />
        </div>
        <Button
          onClick={handleSave}
          disabled={setMutation.isPending || orgNameQuery.isLoading}
        >
          {setMutation.isPending ? "Saving…" : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}

function GlobalInstructionsCard() {
  const query = trpc.settings.get.useQuery({ key: "global_prompt" });
  const setMutation = trpc.settings.set.useMutation({
    onSuccess: () => toast.success("Global AI instructions saved"),
    onError: () => toast.error("Failed to save global AI instructions"),
  });

  const [value, setValue] = useState("");

  useEffect(() => {
    if (query.data?.value !== undefined) {
      setValue(query.data.value);
    }
  }, [query.data?.value]);

  const handleSave = () => {
    setMutation.mutate({ key: "global_prompt", value: value.trim() });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Global AI Instructions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="global-prompt">Organisation-wide guidance</Label>
          <p className="text-xs text-muted-foreground">
            Added to every session&apos;s system prompt across all flows — use it for house
            style, tone, or spelling (e.g. &ldquo;Be matter-of-fact and professional. Use
            Australian English spelling.&rdquo;). Leave blank for none.
          </p>
          <Textarea
            id="global-prompt"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="e.g. Be matter-of-fact and professional. Use Australian English spelling."
            rows={4}
            disabled={query.isLoading}
          />
        </div>
        <Button onClick={handleSave} disabled={setMutation.isPending || query.isLoading}>
          {setMutation.isPending ? "Saving…" : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}

function RegistrationToggleCard() {
  const utils = trpc.useUtils();
  const query = trpc.settings.registrationEnabled.useQuery();
  const mutation = trpc.settings.setRegistrationEnabled.useMutation({
    onSuccess: async () => {
      toast.success("Registration setting saved");
      await utils.settings.registrationEnabled.invalidate();
    },
    onError: () => toast.error("Failed to save registration setting"),
  });

  const enabled = query.data?.enabled ?? true;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">User Registration</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          When enabled, anyone can create an account at <code>/register</code>. New users
          have no admin privileges. Turn this off in production once your team is set up.
        </p>
        <div className="flex items-center justify-between">
          <Label htmlFor="registration-enabled" className="flex-1">
            Allow public registration
          </Label>
          <input
            id="registration-enabled"
            type="checkbox"
            className="h-4 w-4"
            checked={enabled}
            disabled={query.isLoading || mutation.isPending}
            onChange={(e) => mutation.mutate({ enabled: e.target.checked })}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function AuthMethodsCard() {
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

function AiProviderCard({ connectivity }: { connectivity: ConnectivityController }) {
  const utils = trpc.useUtils();
  const aiQuery = trpc.settings.getAiConfig.useQuery();
  const saveMutation = trpc.settings.setAiConfig.useMutation({
    onSuccess: async () => {
      toast.success("AI configuration saved");
      await utils.settings.getAiConfig.invalidate();
      setOpen(false);
    },
    onError: (error) => toast.error(error.message ?? "Failed to save AI configuration"),
  });

  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<Provider>("anthropic");
  const [chatModel, setChatModel] = useState("");
  const [docModel, setDocModel] = useState("");
  const [branchModel, setBranchModel] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [mistralKey, setMistralKey] = useState("");
  const [bedrockRegion, setBedrockRegion] = useState("");
  const [bedrockAccessKeyId, setBedrockAccessKeyId] = useState("");
  const [bedrockSecretAccessKey, setBedrockSecretAccessKey] = useState("");

  const config = aiQuery.data;
  const aiConfigured = config
    ? config.provider === "anthropic"
      ? config.apiKeys.anthropic === "set"
      : config.provider === "openai"
        ? config.apiKeys.openai === "set"
        : config.provider === "mistral"
          ? config.apiKeys.mistral === "set"
          : config.apiKeys.bedrock.accessKeyId === "set" &&
            config.apiKeys.bedrock.secretAccessKey === "set"
    : false;

  useEffect(() => {
    if (!open || !config) return;
    setProvider(config.provider as Provider);
    setChatModel(config.models.chat);
    setDocModel(config.models.documentGeneration);
    setBranchModel(config.models.branching);
    setAnthropicKey("");
    setOpenaiKey("");
    setMistralKey("");
    setBedrockRegion(config.apiKeys.bedrock.region ?? "");
    setBedrockAccessKeyId("");
    setBedrockSecretAccessKey("");
  }, [open, config]);

  const handleProviderChange = (next: Provider) => {
    setProvider(next);
    if (!config) return;
    const defaults = config.defaultModelsForProvider[next];
    setChatModel(defaults.chat);
    setDocModel(defaults.documentGeneration);
    setBranchModel(defaults.branching);
  };

  const handleSave = () => {
    saveMutation.mutate({
      provider,
      apiKeys: {
        anthropic: anthropicKey || null,
        openai: openaiKey || null,
        mistral: mistralKey || null,
        bedrock: {
          region: bedrockRegion || null,
          accessKeyId: bedrockAccessKeyId || null,
          secretAccessKey: bedrockSecretAccessKey || null,
        },
      },
      models: {
        chat: chatModel.trim(),
        documentGeneration: docModel.trim(),
        branching: branchModel.trim(),
      },
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">AI Provider</CardTitle>
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
              <span className="text-muted-foreground">Provider</span>
              <span className="font-medium">{PROVIDER_LABEL[config.provider as Provider]}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Chat model</span>
              <span className="font-mono text-xs">{config.models.chat}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Document generation model</span>
              <span className="font-mono text-xs">{config.models.documentGeneration}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Branching model</span>
              <span className="font-mono text-xs">{config.models.branching}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">API keys</span>
              <span className="font-mono text-xs">
                Anthropic: {config.apiKeys.anthropic === "set" ? "✓" : "—"} · OpenAI:{" "}
                {config.apiKeys.openai === "set" ? "✓" : "—"} · Mistral:{" "}
                {config.apiKeys.mistral === "set" ? "✓" : "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Bedrock</span>
              <span className="font-mono text-xs">
                Region: {config.apiKeys.bedrock.region ?? "—"} · Access key:{" "}
                {config.apiKeys.bedrock.accessKeyId === "set" ? "✓" : "—"} · Secret:{" "}
                {config.apiKeys.bedrock.secretAccessKey === "set" ? "✓" : "—"}
              </span>
            </div>
          </>
        )}
        {aiConfigured && <ConnectivityTest target="ai" controller={connectivity} />}
      </CardContent>

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit AI configuration</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody className="max-h-[70vh] space-y-4 overflow-y-auto">
            <div className="space-y-1">
              <Label htmlFor="ai-provider">Provider</Label>
              <select
                id="ai-provider"
                value={provider}
                onChange={(e) => handleProviderChange(e.target.value as Provider)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="openai">OpenAI</option>
                <option value="mistral">Mistral</option>
                <option value="bedrock">Amazon Bedrock</option>
              </select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="ai-chat-model">Chat model</Label>
              <Input id="ai-chat-model" value={chatModel} onChange={(e) => setChatModel(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ai-doc-model">Document generation model</Label>
              <Input id="ai-doc-model" value={docModel} onChange={(e) => setDocModel(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ai-branch-model">Branching model</Label>
              <Input id="ai-branch-model" value={branchModel} onChange={(e) => setBranchModel(e.target.value)} />
            </div>

            <hr className="border-[#dedad2]" />

            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                Leave a key blank to keep the currently-stored value. Saved keys override <code>.env</code>.
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ai-anthropic-key">Anthropic API key</Label>
              <Input
                id="ai-anthropic-key"
                type="password"
                value={anthropicKey}
                onChange={(e) => setAnthropicKey(e.target.value)}
                placeholder={config?.apiKeys.anthropic === "set" ? "•••••• (stored)" : "Not set"}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ai-openai-key">OpenAI API key</Label>
              <Input
                id="ai-openai-key"
                type="password"
                value={openaiKey}
                onChange={(e) => setOpenaiKey(e.target.value)}
                placeholder={config?.apiKeys.openai === "set" ? "•••••• (stored)" : "Not set"}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ai-mistral-key">Mistral API key</Label>
              <Input
                id="ai-mistral-key"
                type="password"
                value={mistralKey}
                onChange={(e) => setMistralKey(e.target.value)}
                placeholder={config?.apiKeys.mistral === "set" ? "•••••• (stored)" : "Not set"}
              />
            </div>

            <hr className="border-[#dedad2]" />

            <div className="space-y-1">
              <p className="text-xs font-medium text-foreground">Amazon Bedrock credentials</p>
              <p className="text-xs text-muted-foreground">
                Leave any field blank to keep its stored value. All three fields together are required
                for Bedrock calls to succeed.
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ai-bedrock-region">AWS region</Label>
              <Input
                id="ai-bedrock-region"
                value={bedrockRegion}
                onChange={(e) => setBedrockRegion(e.target.value)}
                placeholder="e.g. us-east-1"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ai-bedrock-access-key">AWS access key ID</Label>
              <Input
                id="ai-bedrock-access-key"
                type="password"
                value={bedrockAccessKeyId}
                onChange={(e) => setBedrockAccessKeyId(e.target.value)}
                placeholder={
                  config?.apiKeys.bedrock.accessKeyId === "set" ? "•••••• (stored)" : "Not set"
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ai-bedrock-secret">AWS secret access key</Label>
              <Input
                id="ai-bedrock-secret"
                type="password"
                value={bedrockSecretAccessKey}
                onChange={(e) => setBedrockSecretAccessKey(e.target.value)}
                placeholder={
                  config?.apiKeys.bedrock.secretAccessKey === "set" ? "•••••• (stored)" : "Not set"
                }
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

function N8nIntegrationCard({ connectivity }: { connectivity: ConnectivityController }) {
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

function StorageCard({ connectivity }: { connectivity: ConnectivityController }) {
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

type EmbeddingsProviderChoice = "local" | "openai";

const EMBEDDINGS_PROVIDER_LABEL: Record<EmbeddingsProviderChoice, string> = {
  local: "Local (in-process)",
  openai: "OpenAI",
};

function RagEmbeddingsCard({ connectivity }: { connectivity: ConnectivityController }) {
  const utils = trpc.useUtils();
  const configQuery = trpc.settings.getEmbeddingsConfig.useQuery();
  const saveMutation = trpc.settings.setEmbeddingsConfig.useMutation({
    onSuccess: async () => {
      toast.success("Embedding provider saved — re-index documents to use it");
      await utils.settings.getEmbeddingsConfig.invalidate();
      setOpen(false);
    },
    onError: (error) => toast.error(error.message ?? "Failed to save embedding provider"),
  });

  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<EmbeddingsProviderChoice>("local");
  // Only badge runs that completed while this card was on screen, so navigating
  // away and back does not re-surface a stale "Completed" badge.
  const [mountedAt] = useState(() => Date.now());

  const reindexStatusQuery = trpc.settings.reindexStatus.useQuery(undefined, {
    refetchInterval: (query) => (query.state.data?.status === "running" ? 5000 : false),
  });
  const startReindexMutation = trpc.settings.startReindex.useMutation({
    onSuccess: async (result) => {
      if (!result.started) toast.info("A re-index is already running");
      await utils.settings.reindexStatus.invalidate();
    },
    onError: (error) => toast.error(error.message ?? "Failed to start re-indexing"),
  });

  const config = configQuery.data;
  const reindexStatus = reindexStatusQuery.data;
  const isReindexing = reindexStatus?.status === "running";
  const finishedAfterMount =
    reindexStatus?.finishedAt != null &&
    new Date(reindexStatus.finishedAt).getTime() >= mountedAt;
  const showReindexComplete = reindexStatus?.status === "complete" && finishedAfterMount;
  const showReindexFailed = reindexStatus?.status === "failed" && finishedAfterMount;

  useEffect(() => {
    if (!open || !config) return;
    setProvider(config.provider as EmbeddingsProviderChoice);
  }, [open, config]);

  const handleSave = () => {
    saveMutation.mutate({ provider });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">RAG Embeddings</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={!config}>
          Edit
        </Button>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground">
          Which model embeds uploaded documents for retrieval. Local runs in-process with no
          external API; OpenAI uses the hosted model.
        </p>
        {!config ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Provider</span>
              <span className="font-medium">
                {EMBEDDINGS_PROVIDER_LABEL[config.provider as EmbeddingsProviderChoice] ??
                  config.provider}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Model</span>
              <span className="font-mono text-xs">{config.model}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Dimensions</span>
              <span className="font-mono text-xs">{config.dimension}</span>
            </div>
          </>
        )}

        <div className="space-y-2 border-t pt-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">
              Re-embed every stored document (templates, flow context docs, session
              uploads) with the current provider.
            </span>
            <Button
              size="sm"
              variant="outline"
              data-testid="reindex-button"
              onClick={() => startReindexMutation.mutate()}
              disabled={startReindexMutation.isPending || isReindexing}
            >
              {isReindexing ? "Re-indexing…" : "Re-index all documents"}
            </Button>
          </div>
          {isReindexing && reindexStatus ? (
            <p data-testid="reindex-progress" className="text-xs text-muted-foreground">
              In progress — {reindexStatus.processed} of {reindexStatus.total} documents
              {reindexStatus.failed > 0 ? ` (${reindexStatus.failed} failed)` : ""}…
            </p>
          ) : null}
          {showReindexComplete && reindexStatus ? (
            <p
              data-testid="reindex-complete"
              className="inline-flex rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs text-emerald-900"
            >
              Completed — re-indexed {reindexStatus.succeeded} of {reindexStatus.total} documents
              {reindexStatus.failed > 0 ? `, ${reindexStatus.failed} failed` : ""}.
            </p>
          ) : null}
          {showReindexFailed && reindexStatus ? (
            <p
              data-testid="reindex-failed"
              className="inline-flex rounded-md border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-900"
            >
              Re-index failed{reindexStatus.error ? `: ${reindexStatus.error}` : ""}.
            </p>
          ) : null}
        </div>
        {config && <ConnectivityTest target="embeddings" controller={connectivity} />}
      </CardContent>

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit embedding provider</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="embeddings-provider">Provider</Label>
              <select
                id="embeddings-provider"
                value={provider}
                onChange={(e) => setProvider(e.target.value as EmbeddingsProviderChoice)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="local">Local (in-process)</option>
                <option value="openai">OpenAI</option>
              </select>
            </div>
            <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
              Changing the provider changes how documents are embedded. Existing chunks stay embedded
              with the previous model and will not match queries until each document is re-uploaded or
              re-indexed. OpenAI also requires an OpenAI API key to be configured.
            </p>
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

function SessionUploadsCard() {
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

type ContextBudgetMode = "tokens" | "model_percent";

function DocumentGenerationCard() {
  const utils = trpc.useUtils();
  const configQuery = trpc.settings.getDocumentGenerationConfig.useQuery();
  const saveMutation = trpc.settings.setDocumentGenerationConfig.useMutation({
    onSuccess: async () => {
      toast.success("Document generation settings saved");
      await utils.settings.getDocumentGenerationConfig.invalidate();
      setOpen(false);
    },
    onError: (error) => toast.error(error.message ?? "Failed to save document generation settings"),
  });

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ContextBudgetMode>("tokens");
  const [contextBudgetTokens, setContextBudgetTokens] = useState("100000");
  const [contextBudgetPercent, setContextBudgetPercent] = useState("50");
  const [fieldBatchSize, setFieldBatchSize] = useState("12");
  const [maxPromptTokens, setMaxPromptTokens] = useState("180000");

  const data = configQuery.data;
  const config = data?.config;
  const model = data?.model;

  useEffect(() => {
    if (!open || !config) return;
    setMode(config.contextBudgetMode);
    setContextBudgetTokens(String(config.contextBudgetTokens));
    setContextBudgetPercent(String(config.contextBudgetPercent));
    setFieldBatchSize(String(config.fieldBatchSize));
    setMaxPromptTokens(String(config.maxPromptTokens));
  }, [open, config]);

  const handleSave = () => {
    const tokens = Number(contextBudgetTokens);
    const percent = Number(contextBudgetPercent);
    const batch = Number(fieldBatchSize);
    const maxPrompt = Number(maxPromptTokens);
    if (mode === "tokens" && (!Number.isInteger(tokens) || tokens <= 0)) {
      toast.error("Context budget tokens must be a positive whole number");
      return;
    }
    if (mode === "model_percent" && (!Number.isInteger(percent) || percent < 1 || percent > 100)) {
      toast.error("Context budget percent must be a whole number between 1 and 100");
      return;
    }
    if (!Number.isInteger(batch) || batch <= 0) {
      toast.error("Field batch size must be a positive whole number");
      return;
    }
    if (!Number.isInteger(maxPrompt) || maxPrompt <= 0) {
      toast.error("Max prompt tokens must be a positive whole number");
      return;
    }
    saveMutation.mutate({
      contextBudgetMode: mode,
      contextBudgetTokens: Number.isInteger(tokens) && tokens > 0 ? tokens : 100_000,
      contextBudgetPercent: Number.isInteger(percent) && percent >= 1 && percent <= 100 ? percent : 50,
      fieldBatchSize: batch,
      maxPromptTokens: maxPrompt,
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Document Generation</CardTitle>
        <Button
          size="sm"
          variant="outline"
          data-testid="document-generation-edit"
          onClick={() => setOpen(true)}
          disabled={!config}
        >
          Edit
        </Button>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground">
          Budgets that keep generated-document prompts under the model context window. Defaults match
          the built-in limits; raise or lower them for your model and document set.
        </p>
        {!config ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Context budget</span>
              <span className="font-mono text-xs">
                {config.contextBudgetMode === "model_percent"
                  ? `${config.contextBudgetPercent}% of model window`
                  : `${config.contextBudgetTokens.toLocaleString()} tokens`}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Field batch size</span>
              <span data-testid="document-generation-batch" className="font-mono text-xs">
                {config.fieldBatchSize}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Max prompt tokens</span>
              <span className="font-mono text-xs">{config.maxPromptTokens.toLocaleString()}</span>
            </div>
            {model && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Model context window</span>
                <span className="font-mono text-xs">
                  {model.contextWindowTokens.toLocaleString()} tokens
                  {model.estimated ? " (estimated)" : ""}
                </span>
              </div>
            )}
          </>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit document generation settings</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody className="space-y-4">
            {model && (
              <p className="rounded-md border border-[#dedad2] bg-[#f7f6f3] p-3 text-xs text-muted-foreground">
                Active model <code>{model.model}</code> has a context window of{" "}
                {model.contextWindowTokens.toLocaleString()} tokens
                {model.estimated ? " (estimated — model not in the known list)" : ""}.
              </p>
            )}
            <div className="space-y-1">
              <Label htmlFor="doc-gen-mode">Context budget mode</Label>
              <select
                id="doc-gen-mode"
                value={mode}
                onChange={(e) => setMode(e.target.value as ContextBudgetMode)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="tokens">Explicit token cap</option>
                <option value="model_percent">Percentage of model window</option>
              </select>
            </div>
            {mode === "tokens" ? (
              <div className="space-y-1">
                <Label htmlFor="doc-gen-tokens">Context budget (tokens)</Label>
                <p className="text-xs text-muted-foreground">
                  Maximum reference-document context fed into a single generation call.
                </p>
                <Input
                  id="doc-gen-tokens"
                  value={contextBudgetTokens}
                  onChange={(e) => setContextBudgetTokens(e.target.value)}
                  placeholder="100000"
                />
              </div>
            ) : (
              <div className="space-y-1">
                <Label htmlFor="doc-gen-percent">Context budget (% of model window)</Label>
                <p className="text-xs text-muted-foreground">
                  Share of the model&apos;s context window allotted to reference documents (1–100).
                </p>
                <Input
                  id="doc-gen-percent"
                  value={contextBudgetPercent}
                  onChange={(e) => setContextBudgetPercent(e.target.value)}
                  placeholder="50"
                />
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="doc-gen-batch">Field batch size</Label>
              <p className="text-xs text-muted-foreground">
                Template fields gathered per model call. Smaller keeps each prompt bounded.
              </p>
              <Input
                id="doc-gen-batch"
                value={fieldBatchSize}
                onChange={(e) => setFieldBatchSize(e.target.value)}
                placeholder="12"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="doc-gen-max-prompt">Max prompt tokens</Label>
              <p className="text-xs text-muted-foreground">
                A batch whose prompt would exceed this fails with a clear message instead of calling
                the model.
              </p>
              <Input
                id="doc-gen-max-prompt"
                value={maxPromptTokens}
                onChange={(e) => setMaxPromptTokens(e.target.value)}
                placeholder="180000"
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

type EmailProviderChoice = "smtp" | "m365";

const EMAIL_PROVIDER_LABEL: Record<EmailProviderChoice, string> = {
  smtp: "SMTP",
  m365: "Microsoft 365",
};

function EmailCard({ connectivity }: { connectivity: ConnectivityController }) {
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

function NotificationSettingsCard() {
  const utils = trpc.useUtils();
  const prefsQuery = trpc.settings.getNotificationPrefs.useQuery();
  const saveMutation = trpc.settings.setNotificationPrefs.useMutation({
    onSuccess: async () => {
      toast.success("Notification settings saved");
      await utils.settings.getNotificationPrefs.invalidate();
      setOpen(false);
    },
    onError: (error) => toast.error(error.message ?? "Failed to save notification settings"),
  });

  const [open, setOpen] = useState(false);
  const [sessionComplete, setSessionComplete] = useState(true);
  const [flowShared, setFlowShared] = useState(true);

  const prefs = prefsQuery.data;

  useEffect(() => {
    if (!open || !prefs) return;
    setSessionComplete(prefs.sessionComplete);
    setFlowShared(prefs.flowShared);
  }, [open, prefs]);

  const handleSave = () => {
    saveMutation.mutate({ sessionComplete, flowShared });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Notifications</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={!prefs}>
          Edit
        </Button>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground">
          Control which email notifications Wayfinder sends. Requires email to be configured above.
        </p>
        {!prefs ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Session complete (owner)</span>
              <span className="font-medium">{prefs.sessionComplete ? "On" : "Off"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Flow shared</span>
              <span className="font-medium">{prefs.flowShared ? "On" : "Off"}</span>
            </div>
          </>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Notification settings</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody className="space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <Label htmlFor="notify-session-complete">Session complete</Label>
                <p className="text-xs text-muted-foreground">
                  Emails the session owner when their chat finishes the flow (all steps complete).
                </p>
              </div>
              <input
                id="notify-session-complete"
                type="checkbox"
                className="mt-1 h-4 w-4 shrink-0"
                checked={sessionComplete}
                onChange={(e) => setSessionComplete(e.target.checked)}
              />
            </div>
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <Label htmlFor="notify-flow-shared">Flow shared</Label>
                <p className="text-xs text-muted-foreground">
                  Emails a user when a flow is newly shared with them (they are granted access by
                  another user or admin).
                </p>
              </div>
              <input
                id="notify-flow-shared"
                type="checkbox"
                className="mt-1 h-4 w-4 shrink-0"
                checked={flowShared}
                onChange={(e) => setFlowShared(e.target.checked)}
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

type HrFieldKind = "email" | "name" | "manager" | "position" | "band" | "unit";

const HR_FIELD_OPTIONS: { value: HrFieldKind | ""; label: string }[] = [
  { value: "", label: "— Not mapped —" },
  { value: "email", label: "Email" },
  { value: "name", label: "Display name" },
  { value: "manager", label: "Manager (email)" },
  { value: "position", label: "Position / role" },
  { value: "band", label: "Band / grade" },
  { value: "unit", label: "Business unit" },
];

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

function HrDataCard() {
  const utils = trpc.useUtils();
  const datasetsQuery = trpc.hr.list.useQuery();
  const datasets = datasetsQuery.data ?? [];
  const [isUploading, setIsUploading] = useState(false);
  const [mappingFor, setMappingFor] = useState<string | null>(null);
  const [draftMapping, setDraftMapping] = useState<Record<string, HrFieldKind | "">>({});

  const uploadMutation = trpc.hr.upload.useMutation({
    onSuccess: async () => {
      toast.success("HR dataset uploaded");
      await utils.hr.list.invalidate();
    },
    onError: (error) => toast.error(error.message ?? "Upload failed"),
  });
  const mappingMutation = trpc.hr.setMapping.useMutation({
    onSuccess: async () => {
      toast.success("Column mapping saved");
      await utils.hr.list.invalidate();
      setMappingFor(null);
    },
    onError: (error) => toast.error(error.message ?? "Could not save mapping"),
  });

  const handleFile = async (file: File | null) => {
    if (!file) return;
    const format = file.name.toLowerCase().endsWith(".xlsx") ? "xlsx" : "csv";
    setIsUploading(true);
    try {
      const contentBase64 = await fileToBase64(file);
      await uploadMutation.mutateAsync({ filename: file.name, format, contentBase64 });
    } finally {
      setIsUploading(false);
    }
  };

  const openMapping = (datasetId: string, columns: string[], current: Record<string, string>) => {
    const draft: Record<string, HrFieldKind | ""> = {};
    for (const column of columns) {
      draft[column] = (current[column] as HrFieldKind | undefined) ?? "";
    }
    setDraftMapping(draft);
    setMappingFor(datasetId);
  };

  const saveMapping = () => {
    if (!mappingFor) return;
    const mapping: Record<string, HrFieldKind> = {};
    for (const [header, kind] of Object.entries(draftMapping)) {
      if (kind) mapping[header] = kind;
    }
    mappingMutation.mutate({ datasetId: mappingFor, mapping });
  };

  const editing = datasets.find((dataset) => dataset.id === mappingFor);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">HR Directory Data</CardTitle>
        <label className="cursor-pointer">
          <input
            type="file"
            accept=".csv,.xlsx"
            className="sr-only"
            onChange={(event) => void handleFile(event.target.files?.[0] ?? null)}
          />
          <span className="inline-flex h-8 items-center rounded-md border px-3 text-sm">
            {isUploading ? "Uploading…" : "Upload CSV/XLSX"}
          </span>
        </label>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-xs text-muted-foreground">
          Stored as uploaded and searchable immediately. Map columns so first/second-level
          resolution and the dynamic position lookup can read manager, position, band and unit.
        </p>
        {datasets.length === 0 ? (
          <p className="text-muted-foreground">No HR dataset uploaded yet.</p>
        ) : (
          datasets.map((dataset) => (
            <div
              key={dataset.id}
              className="flex items-center justify-between rounded-md border px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{dataset.filename}</p>
                <p className="text-xs text-muted-foreground">
                  {dataset.rowCount} rows · {dataset.columns.length} columns ·{" "}
                  {Object.keys(dataset.columnMapping).length > 0 ? "mapped" : "not mapped"}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => openMapping(dataset.id, dataset.columns, dataset.columnMapping)}
              >
                Map columns
              </Button>
            </div>
          ))
        )}
      </CardContent>

      <Dialog open={Boolean(mappingFor)} onOpenChange={(open) => !open && setMappingFor(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Map columns</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody className="max-h-[60vh] space-y-3 overflow-y-auto">
            {editing?.columns.map((column) => (
              <div key={column} className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-sm">{column}</span>
                <select
                  aria-label={`Mapping for ${column}`}
                  className="h-9 rounded-md border px-2 text-sm"
                  value={draftMapping[column] ?? ""}
                  onChange={(event) =>
                    setDraftMapping((prev) => ({
                      ...prev,
                      [column]: event.target.value as HrFieldKind | "",
                    }))
                  }
                >
                  {HR_FIELD_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setMappingFor(null)}>
              Cancel
            </Button>
            <Button onClick={saveMapping} disabled={mappingMutation.isPending}>
              Save mapping
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function EntraDirectoryCard({ connectivity }: { connectivity: ConnectivityController }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Approver Directory (Microsoft Entra)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-muted-foreground">
        <p>
          Approver resolution reuses the email notification Microsoft 365 app registration
          (<code>M365_TENANT_ID</code>, <code>M365_CLIENT_ID</code>, <code>M365_CLIENT_SECRET</code>).
        </p>
        <p>
          Grant the application Graph permissions <code>User.Read.All</code> and{" "}
          <code>Directory.Read.All</code> (tenant admin consent) to enable live reporting-line and
          people search. Until then, resolution falls back to the HR upload and manual pick.
        </p>
        <ConnectivityTest target="entra" controller={connectivity} />
      </CardContent>
    </Card>
  );
}

export default function AppSettingsPage() {
  const connectivity = useConnectivity();

  return (
    <div className="h-full overflow-auto">
      <div className="container py-8">
        <div className="space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight">Configuration</h1>
              <p className="text-sm text-muted-foreground">
                Configure global behaviour for this application.
              </p>
            </div>
            <Button
              variant="outline"
              data-testid="test-all-connectivity"
              onClick={() => void connectivity.runAll(ALL_CONNECTIVITY_TARGETS)}
              disabled={connectivity.isBusy}
            >
              {connectivity.isBusy ? "Testing…" : "Test all"}
            </Button>
          </div>

          <div className="space-y-4">
            <OrganisationNameCard />
            <RegistrationToggleCard />
            <AuthMethodsCard />

            <h2
              data-testid="settings-section-ai"
              className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              AI
            </h2>
            <GlobalInstructionsCard />
            <AiProviderCard connectivity={connectivity} />
            <DocumentGenerationCard />

            <N8nIntegrationCard connectivity={connectivity} />
            <RagEmbeddingsCard connectivity={connectivity} />
            <StorageCard connectivity={connectivity} />
            <SessionUploadsCard />
            <EmailCard connectivity={connectivity} />
            <NotificationSettingsCard />
            <HrDataCard />
            <EntraDirectoryCard connectivity={connectivity} />
          </div>
        </div>
      </div>
    </div>
  );
}
