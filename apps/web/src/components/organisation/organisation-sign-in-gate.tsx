"use client";

import { useSignInPrompts } from "@/components/layout/sign-in-prompts";
import { trpc } from "@/trpc/client";
import { NominationDialog } from "./nomination-dialog";

// First-login organisation gate (ADR-038 §4). Runs membership resolution once
// per session: email_domain auto-assigns server-side (no dialog), while
// self_nomination — or an email-domain miss set to nominate — surfaces a prompt
// to create or join. Dismissible ("Not now") so a user is never hard-locked.
export function OrganisationSignInGate() {
  // Shared rather than local: the welcome tour waits behind this prompt and
  // cannot see a dismissal in the server state (see SignInPromptsProvider).
  const { organisationPromptDismissed, dismissOrganisationPrompt } = useSignInPrompts();
  const signInState = trpc.organisation.signInState.useQuery(undefined, {
    // Resolution depends only on the stored user + config, so one check per mount
    // is enough; refetching on focus would re-open a dismissed prompt.
    refetchOnWindowFocus: false,
  });

  if (organisationPromptDismissed) return null;
  if (signInState.data?.status !== "nominate") return null;

  return (
    <NominationDialog
      mode={signInState.data.mode}
      joinable={signInState.data.joinable}
      onDone={dismissOrganisationPrompt}
    />
  );
}
