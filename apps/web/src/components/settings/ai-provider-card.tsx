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

type Provider = "anthropic" | "openai" | "mistral" | "bedrock";

const PROVIDER_LABEL: Record<Provider, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI",
  mistral: "Mistral",
  bedrock: "Amazon Bedrock",
};
export function AiProviderCard({ connectivity }: { connectivity: ConnectivityController }) {
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
