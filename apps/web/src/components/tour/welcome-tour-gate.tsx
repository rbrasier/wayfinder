"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { useSignInPrompts } from "@/components/layout/sign-in-prompts";
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
  const [dismissed, setDismissed] = useState(false);

  const meQuery = trpc.user.me.useQuery();
  const signInState = trpc.organisation.signInState.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const publishedFlowsQuery = trpc.session.listPublishedFlows.useQuery();

  const completeMutation = trpc.user.completeWelcomeTour.useMutation({
    onSuccess: () => void utils.user.me.invalidate(),
  });
  const createSessionMutation = trpc.session.create.useMutation({
    onSuccess: (session) => {
      void utils.session.list.invalidate();
      toast.success("Chat started");
      router.push(`/chats/${session.id}`);
    },
    onError: (error) => toast.error(error.message),
  });

  const show = shouldShowWelcomeTour({
    welcomeTourPending: meQuery.data?.welcomeTourPending,
    organisationSignInStatus: signInState.data?.status,
    organisationPromptDismissed,
    dismissed,
  });
  if (!show) return null;

  // Local dismissal first so the modal never lingers on a slow network; the
  // stamp follows and the next page load reads it from the server.
  const complete = () => {
    setDismissed(true);
    completeMutation.mutate();
  };

  return (
    <WelcomeTourDialog
      publishedFlows={publishedFlowsQuery.data ?? []}
      canCreateFlows={permissions.has("workflow:create_own")}
      isStartingChat={createSessionMutation.isPending}
      onStartChat={(flowId) => {
        completeMutation.mutate();
        createSessionMutation.mutate({ flowId });
      }}
      onBuildFlow={() => {
        complete();
        router.push(withTourStage("/flows", "new-flow"));
      }}
      onSkip={complete}
    />
  );
}
