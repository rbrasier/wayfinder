"use client";

import { useEffect, useMemo, useState } from "react";
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

type Provider = "anthropic" | "openai" | "mistral" | "bedrock";

const PROVIDER_LABEL: Record<Provider, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI",
  mistral: "Mistral",
  bedrock: "Amazon Bedrock",
};

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
          When enabled, anyone can create an account at <code>/admin/register</code>. New users
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

function AiProviderCard() {
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

function StorageCard() {
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

export default function AppSettingsPage() {
  return (
    <div className="h-full overflow-auto">
      <div className="container py-8">
        <div className="space-y-6">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Application Settings</h1>
            <p className="text-sm text-muted-foreground">
              Configure global behaviour for this application.
            </p>
          </div>

          <div className="space-y-4">
            <OrganisationNameCard />
            <RegistrationToggleCard />
            <AiProviderCard />
            <StorageCard />
            <SessionUploadsCard />
          </div>
        </div>
      </div>
    </div>
  );
}
