"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NominationDialog } from "@/components/organisation/nomination-dialog";
import { trpc } from "@/trpc/client";

// Lets a user change their own organisation, but only where the deployment
// leaves that choice to them (ADR-038 §4). Under an admin-assigned or SSO-claim
// strategy the card stays hidden — the setting is not theirs to change, and the
// server would reject the write anyway.
export function OrganisationMembershipCard() {
  const [changing, setChanging] = useState(false);
  const optionsQuery = trpc.organisation.nominationOptions.useQuery();
  const mineQuery = trpc.organisation.mine.useQuery();

  const options = optionsQuery.data;
  if (!options?.canSelfSelect) return null;

  const current = mineQuery.data;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Organisation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Flows published to your organisation appear in your list. Changing this changes which
            shared flows you can see.
          </p>

          <div className="space-y-1.5">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Current organisation
            </p>
            <p className="text-sm text-[#1c1b19]">
              {mineQuery.isLoading ? "Loading…" : (current?.name ?? "Not set")}
            </p>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="change-organisation"
            onClick={() => setChanging(true)}
          >
            {current ? "Change organisation" : "Choose organisation"}
          </Button>
        </CardContent>
      </Card>

      {changing && (
        <NominationDialog
          mode={options.mode}
          joinable={options.joinable}
          currentOrganisationId={current?.id ?? null}
          title={current ? "Change your organisation" : "Choose your organisation"}
          description="Pick the organisation you belong to. Flows shared with it will appear in your list."
          dismissLabel="Cancel"
          onDone={() => setChanging(false)}
        />
      )}
    </>
  );
}
