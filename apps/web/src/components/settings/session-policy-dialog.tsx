"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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

interface SessionPolicyDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/**
 * Session lifecycle policy (ADR-035), opened from the Authentication card.
 *
 * A controlled dialog rather than a card of its own: session policy is part of
 * how sign-in behaves, so it belongs behind the same card as the sign-in
 * methods rather than competing with them for space on the settings page.
 */
export function SessionPolicyDialog({ open, onOpenChange }: SessionPolicyDialogProps) {
  const utils = trpc.useUtils();
  // Only fetched once the dialog is opened — the settings page no longer shows
  // the policy, so nothing needs it before then.
  const policyQuery = trpc.settings.getSessionPolicy.useQuery(undefined, { enabled: open });
  const saveMutation = trpc.settings.setSessionPolicy.useMutation({
    onSuccess: async () => {
      toast.success("Session policy saved");
      await utils.settings.getSessionPolicy.invalidate();
      onOpenChange(false);
    },
    onError: (error) => toast.error(error.message ?? "Failed to save the session policy"),
  });

  const [idleTimeoutMinutes, setIdleTimeoutMinutes] = useState(0);
  const [absoluteTimeoutMinutes, setAbsoluteTimeoutMinutes] = useState(0);
  const [concurrentSessionLimit, setConcurrentSessionLimit] = useState(0);
  const [evictionStrategy, setEvictionStrategy] = useState<"evict_oldest" | "refuse">(
    "evict_oldest",
  );

  const policy = policyQuery.data;

  useEffect(() => {
    if (!open || !policy) return;
    setIdleTimeoutMinutes(policy.idleTimeoutMinutes);
    setAbsoluteTimeoutMinutes(policy.absoluteTimeoutMinutes);
    setConcurrentSessionLimit(policy.concurrentSessionLimit);
    setEvictionStrategy(policy.evictionStrategy);
  }, [open, policy]);

  const handleSave = () => {
    // The server enforces this too — checking here only saves a round trip.
    const bothTimeoutsOn = idleTimeoutMinutes > 0 && absoluteTimeoutMinutes > 0;
    if (bothTimeoutsOn && absoluteTimeoutMinutes < idleTimeoutMinutes) {
      toast.error("The absolute timeout must be at least as long as the idle timeout");
      return;
    }
    saveMutation.mutate({
      idleTimeoutMinutes,
      absoluteTimeoutMinutes,
      concurrentSessionLimit,
      evictionStrategy,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Session policies</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>
        <DialogBody className="max-h-[70vh] space-y-4 overflow-y-auto">
          <p className="text-sm text-muted-foreground">
            How long sign-in sessions last and how many each person may hold. Changes apply on the
            next request — no redeploy needed.
          </p>
          {!policy ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <>
              <div className="space-y-1">
                <Label htmlFor="session-policy-idle-input">Idle timeout (minutes)</Label>
                <Input
                  id="session-policy-idle-input"
                  type="number"
                  min={0}
                  value={idleTimeoutMinutes}
                  onChange={(event) => setIdleTimeoutMinutes(Number(event.target.value))}
                />
                <p className="text-xs text-muted-foreground">
                  Sign out a session after this long without activity. 0 switches it off.
                </p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="session-policy-absolute-input">Absolute timeout (minutes)</Label>
                <Input
                  id="session-policy-absolute-input"
                  type="number"
                  min={0}
                  value={absoluteTimeoutMinutes}
                  onChange={(event) => setAbsoluteTimeoutMinutes(Number(event.target.value))}
                />
                <p className="text-xs text-muted-foreground">
                  Maximum age of a session however active it is. 0 switches it off.
                </p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="session-policy-limit-input">Concurrent sessions per user</Label>
                <Input
                  id="session-policy-limit-input"
                  type="number"
                  min={0}
                  value={concurrentSessionLimit}
                  onChange={(event) => setConcurrentSessionLimit(Number(event.target.value))}
                />
                <p className="text-xs text-muted-foreground">0 means no limit.</p>
              </div>
              {concurrentSessionLimit > 0 && (
                <div className="space-y-1">
                  <Label htmlFor="session-policy-strategy">When someone is at the limit</Label>
                  <select
                    id="session-policy-strategy"
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                    value={evictionStrategy}
                    onChange={(event) =>
                      setEvictionStrategy(
                        event.target.value === "refuse" ? "refuse" : "evict_oldest",
                      )
                    }
                  >
                    <option value="evict_oldest">Sign out their oldest session</option>
                    <option value="refuse">Refuse the new sign-in</option>
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Administrators always sign in, evicting their oldest session, so no policy can
                    lock every administrator out.
                  </p>
                </div>
              )}
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={saveMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!policy || saveMutation.isPending}
            data-testid="session-policy-save"
          >
            {saveMutation.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
