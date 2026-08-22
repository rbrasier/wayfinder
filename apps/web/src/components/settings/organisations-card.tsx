"use client";

import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { OrganisationNameFields } from "@/components/settings/organisation-name-card";
import { resolveOrganisationsCardMode } from "@/components/settings/organisations-card-model";
import { trpc } from "@/trpc/client";

// Master switch for the organisations feature, sitting under the single
// organisation name it replaces (ADR-038 + the v2.10.0 UI gate). Off by default:
// when off, that one name is used in AI prompts and no membership resolution
// runs on sign-in; when on, each member's own organisation is used instead.
export function OrganisationsCard() {
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
  const mode = resolveOrganisationsCardMode(enabledQuery.data);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Organisations</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {mode === "single-name" ? (
          <OrganisationNameFields />
        ) : (
          <p className="text-xs text-muted-foreground">
            Each member is grounded in their own organisation. Name and assign them under{" "}
            <Link href="/admin/organisations" className="text-[#2f56d3] hover:underline">
              Organisations
            </Link>
            .
          </p>
        )}

        <div className="flex items-start justify-between gap-3 border-t border-[#f0ede8] pt-4">
          <div className="space-y-0.5">
            <Label htmlFor="organisations-enabled">Enable organisations</Label>
            <p className="text-xs text-muted-foreground">
              Group users into organisations for internal sharing and to ground the AI in each
              member&apos;s own organisation. When off, the single organisation name above is used
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
              enabled ? "bg-[#1f6b4d]" : "bg-[#dedad2]"
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
