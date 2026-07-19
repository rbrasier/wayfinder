"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { trpc } from "@/trpc/client";

// First-login organisation gate (ADR-038 §4). Runs membership resolution once
// per session: email_domain auto-assigns server-side (no dialog), while
// self_nomination — or an email-domain miss set to nominate — surfaces a prompt
// to create or join. Dismissible ("Not now") so a user is never hard-locked.
export function OrganisationSignInGate() {
  const [dismissed, setDismissed] = useState(false);
  const signInState = trpc.organisation.signInState.useQuery(undefined, {
    // Resolution depends only on the stored user + config, so one check per mount
    // is enough; refetching on focus would re-open a dismissed prompt.
    refetchOnWindowFocus: false,
  });

  if (dismissed) return null;
  if (signInState.data?.status !== "nominate") return null;

  return (
    <NominationDialog
      mode={signInState.data.mode}
      joinable={signInState.data.joinable}
      onDone={() => setDismissed(true)}
    />
  );
}

function NominationDialog({
  mode,
  joinable,
  onDone,
}: {
  mode: "create_or_join" | "join_existing";
  joinable: Array<{ id: string; name: string }>;
  onDone: () => void;
}) {
  const utils = trpc.useUtils();
  const canCreate = mode === "create_or_join";
  const [choice, setChoice] = useState<"join" | "create">(joinable.length > 0 ? "join" : "create");
  const [joinId, setJoinId] = useState(joinable[0]?.id ?? "");
  const [createName, setCreateName] = useState("");

  const submit = trpc.organisation.submitNomination.useMutation({
    onSuccess: async () => {
      toast.success("Organisation set");
      await Promise.all([
        utils.organisation.signInState.invalidate(),
        utils.organisation.mine.invalidate(),
      ]);
      onDone();
    },
    onError: (error) => toast.error(error.message ?? "Could not set your organisation"),
  });

  const effectiveChoice = canCreate ? choice : "join";
  const handleSubmit = () => {
    if (effectiveChoice === "create") {
      if (!createName.trim()) return;
      submit.mutate({ createName: createName.trim() });
      return;
    }
    if (!joinId) return;
    submit.mutate({ joinOrganisationId: joinId });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onDone()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Choose your organisation</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Pick the organisation you belong to. Flows shared with it will appear in your list.
          </p>

          {canCreate && joinable.length > 0 && (
            <fieldset className="space-y-2">
              <legend className="sr-only">Create or join</legend>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="nomination-choice"
                  checked={choice === "join"}
                  onChange={() => setChoice("join")}
                />
                Join an existing organisation
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="nomination-choice"
                  checked={choice === "create"}
                  onChange={() => setChoice("create")}
                />
                Create a new organisation
              </label>
            </fieldset>
          )}

          {effectiveChoice === "join" && (
            <div className="flex flex-col gap-1">
              <label htmlFor="nomination-join" className="text-sm font-medium">
                Organisation
              </label>
              {joinable.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No organisations to join yet.
                </p>
              ) : (
                <select
                  id="nomination-join"
                  className="rounded-md border border-[#d6d2ca] bg-white px-2 py-1 text-sm"
                  value={joinId}
                  onChange={(event) => setJoinId(event.target.value)}
                >
                  {joinable.map((organisation) => (
                    <option key={organisation.id} value={organisation.id}>
                      {organisation.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {effectiveChoice === "create" && canCreate && (
            <div className="flex flex-col gap-1">
              <label htmlFor="nomination-create" className="text-sm font-medium">
                New organisation name
              </label>
              <Input
                id="nomination-create"
                placeholder="e.g. Procurement"
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
              />
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onDone} disabled={submit.isPending}>
            Not now
          </Button>
          <Button onClick={handleSubmit} disabled={submit.isPending}>
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
