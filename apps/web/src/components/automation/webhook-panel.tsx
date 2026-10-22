"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { FlowTrigger } from "@rbrasier/domain";
import { Button } from "@/components/ui/button";
import { trpc } from "@/trpc/client";

const copy = (value: string, what: string) =>
  void navigator.clipboard.writeText(value).then(() => toast.success(`${what} copied`));

function OneTimeSecret({ label, value, onDismiss }: { label: string; value: string; onDismiss: () => void }) {
  return (
    <div role="status" className="space-y-1.5 rounded-[9px] border border-[#e9c46a] bg-[#fdf6e3] p-3">
      <p className="text-[12.5px] font-medium text-[#7a4b0c]">
        {label} — copy it now. It is shown only this once.
      </p>
      <code className="block break-all rounded bg-white px-2 py-1 text-[12px]">{value}</code>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => copy(value, label)}>
          Copy
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Done
        </Button>
      </div>
    </div>
  );
}

// Start this flow from another system (ADR-064 §3): on/off, the address, the
// token and optional HMAC signing.
export function WebhookPanel({
  flowId,
  webhook,
  webhookUrl,
}: {
  flowId: string;
  webhook: FlowTrigger | null;
  webhookUrl: string;
}) {
  const utils = trpc.useUtils();
  const [revealed, setRevealed] = useState<{ label: string; value: string } | null>(null);
  const refresh = () => utils.automation.flowTriggers.invalidate({ flowId });
  const onError = (error: { message: string }) => toast.error(error.message);

  const configure = trpc.automation.configureWebhook.useMutation({
    onSuccess: async (data) => {
      if (data.token) setRevealed({ label: "Webhook token", value: data.token });
      await refresh();
    },
    onError,
  });
  const rotate = trpc.automation.rotateWebhookToken.useMutation({
    onSuccess: async (data) => {
      setRevealed({ label: "New webhook token", value: data.token });
      await refresh();
    },
    onError,
  });
  const hmac = trpc.automation.setWebhookHmac.useMutation({
    onSuccess: async (data) => {
      if (data.secret) setRevealed({ label: "Signing secret", value: data.secret });
      await refresh();
    },
    onError,
  });

  const enabled = webhook?.enabled ?? false;

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-[13px] text-[#1c1b19]">
        <input
          type="checkbox"
          checked={enabled}
          disabled={configure.isPending}
          onChange={(event) => configure.mutate({ flowId, enabled: event.target.checked })}
        />
        Let other systems start this flow
      </label>

      {revealed && <OneTimeSecret label={revealed.label} value={revealed.value} onDismiss={() => setRevealed(null)} />}

      {enabled && webhook && (
        <div className="space-y-2 text-[13px]">
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-[#f5f3ee] px-2 py-1 text-[12px]">POST {webhookUrl}</code>
            <Button size="sm" variant="outline" onClick={() => copy(webhookUrl, "Address")}>
              Copy
            </Button>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[#5c574c]">
              Token: <code>wf_wh_…{webhook.tokenLastFour ?? "????"}</code>
            </span>
            <Button size="sm" variant="outline" disabled={rotate.isPending} onClick={() => rotate.mutate({ flowId })}>
              Rotate token
            </Button>
          </div>
          <label className="flex items-center gap-2 text-[#1c1b19]">
            <input
              type="checkbox"
              checked={webhook.hasHmacSecret}
              disabled={hmac.isPending}
              onChange={(event) => hmac.mutate({ flowId, enabled: event.target.checked })}
            />
            Also require an HMAC signature (X-Wayfinder-Signature: sha256=…)
          </label>
          <p className="text-[12px] text-[#736d5f]">
            Send <code>Authorization: Bearer &lt;token&gt;</code> and a JSON body such as{" "}
            <code>{'{"inputs": {"hearing_id": "…"}}'}</code>. Runs start as the person who turned this on.
          </p>
        </div>
      )}
    </div>
  );
}
