"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldGroupLabel } from "@/components/ui/field-group-label";
import { trpc } from "@/trpc/client";
import { RunHistoryList } from "./run-history-list";
import { TriggerInputsEditor } from "./trigger-inputs-editor";
import { WebhookPanel } from "./webhook-panel";

// The flow's triggers (ADR-064): the inputs it expects, its webhook, and the
// runs the webhook started.
export function FlowTriggersButton({ flowId }: { flowId: string }) {
  const [open, setOpen] = useState(false);
  const utils = trpc.useUtils();
  const triggers = trpc.automation.flowTriggers.useQuery({ flowId }, { enabled: open });
  const runs = trpc.automation.webhookRuns.useQuery({ flowId }, { enabled: open });
  const retry = trpc.automation.retryRun.useMutation({
    onSuccess: async () => {
      toast.success("Run retried");
      await utils.automation.webhookRuns.invalidate({ flowId });
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Triggers
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Triggers</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody className="space-y-5">
            {!triggers.data ? (
              <p className="text-[13px] text-[#736d5f]">Loading…</p>
            ) : (
              <>
                <section className="space-y-2">
                  <FieldGroupLabel id="triggers-inputs">Inputs</FieldGroupLabel>
                  <TriggerInputsEditor flowId={flowId} saved={triggers.data.triggerInputs} />
                </section>
                {triggers.data.canManageWebhook && (
                  <section className="space-y-2">
                    <FieldGroupLabel id="triggers-webhook">Start via webhook</FieldGroupLabel>
                    <WebhookPanel flowId={flowId} webhook={triggers.data.webhook} webhookUrl={triggers.data.webhookUrl} />
                  </section>
                )}
                {triggers.data.webhook && (
                  <section className="space-y-2">
                    <FieldGroupLabel id="triggers-runs">Recent webhook runs</FieldGroupLabel>
                    <RunHistoryList
                      runs={runs.data ?? []}
                      onRetry={(sessionId) => retry.mutate({ sessionId })}
                      retryingSessionId={retry.isPending ? (retry.variables?.sessionId ?? null) : null}
                    />
                  </section>
                )}
              </>
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
}
