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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/trpc/client";

const toLines = (entries: string[]): string => entries.join("\n");
const fromLines = (text: string): string[] => text.split("\n");

const summary = (entries: string[], empty: string): string =>
  entries.length === 0 ? empty : entries.join(", ");

// Install-wide limits for unattended automation (ADR-063 §6, ADR-065 §4).
export function AutomationCard() {
  const utils = trpc.useUtils();
  const configQuery = trpc.settings.getAutomation.useQuery();
  const [open, setOpen] = useState(false);
  const [hosts, setHosts] = useState("");
  const [domains, setDomains] = useState("");
  const saveMutation = trpc.settings.setAutomation.useMutation({
    onSuccess: async () => {
      toast.success("Automation settings saved");
      await utils.settings.getAutomation.invalidate();
      setOpen(false);
    },
    onError: (error) => toast.error(error.message ?? "Failed to save automation settings"),
  });
  const config = configQuery.data;

  useEffect(() => {
    if (!open || !config) return;
    setHosts(toLines(config.watchAllowedHosts));
    setDomains(toLines(config.emailAllowedDomains));
  }, [open, config]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Automation</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={!config}>
          Edit
        </Button>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground">
          Limits for Event Watches and Email steps. Watches cannot call private network addresses unless the host
          is listed here.
        </p>
        {!config ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Private hosts watches may call</span>
              <span className="text-right font-medium">{summary(config.watchAllowedHosts, "None")}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Email steps may send to</span>
              <span className="text-right font-medium">{summary(config.emailAllowedDomains, "Any domain")}</span>
            </div>
          </>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && setOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Automation</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody className="space-y-5">
            <div className="space-y-1">
              <Label htmlFor="automation-hosts">Private hosts Event Watches may call</Label>
              <Textarea
                id="automation-hosts"
                rows={4}
                value={hosts}
                onChange={(event) => setHosts(event.target.value)}
                placeholder={"hearings.internal\n10.0.4.12"}
              />
              <p className="text-xs text-muted-foreground">
                One host name or IP address per line. Public internet addresses never need listing.
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="automation-domains">Email domains Email steps may send to</Label>
              <Textarea
                id="automation-domains"
                rows={4}
                value={domains}
                onChange={(event) => setDomains(event.target.value)}
                placeholder="agency.gov.au"
              />
              <p className="text-xs text-muted-foreground">
                One domain per line. Leave empty to allow any domain. Wayfinder users and groups are always allowed.
              </p>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                saveMutation.mutate({ watchAllowedHosts: fromLines(hosts), emailAllowedDomains: fromLines(domains) })
              }
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
