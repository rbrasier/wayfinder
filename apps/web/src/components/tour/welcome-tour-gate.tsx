"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { useSignInPrompts } from "@/components/layout/sign-in-prompts";
import { BusyOverlay } from "@/components/ui/busy-overlay";
import { useNavigationBusy } from "@/lib/use-navigation-busy";
import { usePermissions } from "@/lib/use-permissions";
import { trpc } from "@/trpc/client";
import { shouldShowWelcomeTour, withTourStage } from "./tour-stage";
import { WelcomeTourDialog } from "./welcome-tour-dialog";

// First-login welcome gate (ADR-056). Sits beside the organisation sign-in gate
// in the (user) layout and yields to it; shows once per user until restarted.
export function WelcomeTourGate() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const permissions = usePermissions();
  const { organisationPromptDismissed } = useSignInPrompts();
  const busy = useNavigationBusy();
  const [busyLabel, setBusyLabel] = useState("Starting your chat…");

  const meQuery = trpc.user.me.useQuery();
  const signInState = trpc.organisation.signInState.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const publishedFlowsQuery = trpc.session.listPublishedFlows.useQuery();

  const completeMutation = trpc.user.completeWelcomeTour.useMutation({
    // Write the completion into the cache before the server answers, so the
    // modal closes on the click rather than after a round-trip. This replaces a
    // local "dismissed" flag, which survived client-side navigation in this
    // layout and so swallowed every later restart from Settings.
    onMutate: async () => {
      await utils.user.me.cancel();
      utils.user.me.setData(undefined, (previous) =>
        previous ? { ...previous, welcomeTourPending: false } : previous,
      );
    },
    onSuccess: () => void utils.user.me.invalidate(),
    // Deliberately no rollback: a failed stamp means the tour really is still
    // pending, but re-opening the modal the person just closed is worse than
    // letting it return on their next page load.
    onError: (error) => toast.error(error.message),
  });

  const createSessionMutation = trpc.session.create.useMutation({
    onSuccess: (session) => {
      void utils.session.list.invalidate();
      router.push(`/chats/${session.id}`);
    },
    onError: (error) => {
      busy.stop();
      toast.error(error.message);
    },
  });

  const show = shouldShowWelcomeTour({
    welcomeTourPending: meQuery.data?.welcomeTourPending,
    organisationSignInStatus: signInState.data?.status,
    organisationPromptDismissed,
  });

  const leaveFor = (label: string, go: () => void) => {
    setBusyLabel(label);
    busy.start();
    completeMutation.mutate();
    go();
  };

  return (
    <>
      {/* Outside the `show` guard: choosing a path closes the dialog at once,
          and the wait it covers runs on past that. */}
      {busy.busy && <BusyOverlay label={busyLabel} />}
      {show && (
        <WelcomeTourDialog
          publishedFlows={publishedFlowsQuery.data ?? []}
          canCreateFlows={permissions.has("workflow:create_own")}
          isStartingChat={createSessionMutation.isPending}
          onStartChat={(flowId) =>
            leaveFor("Starting your chat…", () => createSessionMutation.mutate({ flowId }))
          }
          onBuildFlow={() =>
            leaveFor("Opening the flow builder…", () =>
              router.push(withTourStage("/flows", "new-flow")),
            )
          }
          onSkip={() => completeMutation.mutate()}
        />
      )}
    </>
  );
}
