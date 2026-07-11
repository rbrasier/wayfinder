"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { trpc } from "@/trpc/client";

export function NotificationSettingsCard() {
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
