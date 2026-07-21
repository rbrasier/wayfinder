"use client";

import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { trpc } from "@/trpc/client";

// Master switch for the organisations feature (ADR-038). Off by default: when
// off, a single global organisation name is used in AI prompts and no membership
// resolution runs on sign-in.
export function OrganisationsToggleCard() {
  const utils = trpc.useUtils();
  const enabledQuery = trpc.organisation.isEnabled.useQuery();
  const setEnabled = trpc.organisation.setEnabled.useMutation({
    onSuccess: async ({ enabled }) => {
      toast.success(enabled ? "Organisations enabled" : "Organisations disabled");
      await utils.organisation.isEnabled.invalidate();
    },
    onError: (error) => toast.error(error.message ?? "Failed to update setting"),
  });

  const enabled = enabledQuery.data ?? false;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Organisations</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <Label htmlFor="organisations-enabled">Enable organisations</Label>
            <p className="text-xs text-muted-foreground">
              Group users into organisations for internal sharing and to ground the AI in each
              member&apos;s own organisation. When off, the single organisation name below is used
              everywhere.
            </p>
          </div>
          <button
            id="organisations-enabled"
            type="button"
            role="switch"
            aria-checked={enabled}
            disabled={enabledQuery.isLoading || setEnabled.isPending}
            onClick={() => setEnabled.mutate({ enabled: !enabled })}
            className={`relative mt-1 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
              enabled ? "bg-[#1f8a4c]" : "bg-[#d7d3cc]"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                enabled ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
