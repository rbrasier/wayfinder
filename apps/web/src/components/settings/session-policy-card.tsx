"use client";

import { useEffect, useState } from "react";
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

// 0 is a real, meaningful value for all three numbers, so the summary says what
// it means rather than showing a bare zero.
const describeMinutes = (minutes: number): string =>
  minutes === 0 ? "Not enforced" : `${minutes} minutes`;

const describeLimit = (limit: number): string =>
  limit === 0 ? "No limit" : `${limit} per user`;

export function SessionPolicyCard() {
  const utils = trpc.useUtils();
  const policyQuery = trpc.settings.getSessionPolicy.useQuery();
  const saveMutation = trpc.settings.setSessionPolicy.useMutation({
    onSuccess: async () => {
      toast.success("Session policy saved");
      await utils.settings.getSessionPolicy.invalidate();
      setOpen(false);
    },
    onError: (error) => toast.error(error.message ?? "Failed to save the session policy"),
  });

  const [open, setOpen] = useState(false);
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
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Session policy</CardTitle>
        <Button
          size="sm"
          variant="outline"
          data-testid="session-policy-edit"
          onClick={() => setOpen(true)}
          disabled={!policy}
        >
          Edit
        </Button>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground">
          How long sign-in sessions last and how many each person may hold. Changes apply on the
          next request — no redeploy needed.
        </p>
        {!policy ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="flex justify-between" data-testid="session-policy-idle">
              <span className="text-muted-foreground">Idle timeout</span>
              <span className="font-medium">{describeMinutes(policy.idleTimeoutMinutes)}</span>
            </div>
            <div className="flex justify-between" data-testid="session-policy-absolute">
              <span className="text-muted-foreground">Absolute timeout</span>
              <span className="font-medium">{describeMinutes(policy.absoluteTimeoutMinutes)}</span>
            </div>
            <div className="flex justify-between" data-testid="session-policy-concurrency">
              <span className="text-muted-foreground">Concurrent sessions</span>
              <span className="font-medium">{describeLimit(policy.concurrentSessionLimit)}</span>
            </div>
            {policy.concurrentSessionLimit > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">At the limit</span>
                <span className="font-medium">
                  {policy.evictionStrategy === "refuse"
                    ? "Refuse the new sign-in"
                    : "Sign out the oldest session"}
                </span>
              </div>
            )}
          </>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={(isOpen) => !isOpen && setOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit session policy</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody className="max-h-[70vh] space-y-4 overflow-y-auto">
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
                    setEvictionStrategy(event.target.value === "refuse" ? "refuse" : "evict_oldest")
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
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saveMutation.isPending}
              data-testid="session-policy-save"
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
