"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useSignInPrompts } from "@/components/layout/sign-in-prompts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { trpc } from "@/trpc/client";
import { isLoginNoticeCleared, shouldShowLoginNotice } from "./login-notice-state";

const preventClose = (event: Event) => event.preventDefault();

// The sign-in notice (ADR-060 §5): a modal the user cannot close without
// acknowledging it. Mounted in the (user) and (admin) layouts; the organisation
// and welcome prompts wait for it through SignInPromptsProvider.
export function LoginNoticeGate() {
  const { clearLoginNotice } = useSignInPrompts();
  const [acknowledgedVersion, setAcknowledgedVersion] = useState<number | null>(null);

  const statusQuery = trpc.settings.getLoginNoticeStatus.useQuery(undefined, {
    // One answer per page load: re-checking on focus would re-open the modal
    // mid-task if an admin rewords the notice.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const acknowledgeMutation = trpc.settings.acknowledgeLoginNotice.useMutation({
    onError: (error) => {
      // Re-open with whatever is current: most often the wording changed while
      // the modal was up, and the new version must be read before continuing.
      setAcknowledgedVersion(null);
      void statusQuery.refetch();
      toast.error(error.message);
    },
  });

  const status = statusQuery.data;
  const cleared = isLoginNoticeCleared(
    { status, failed: statusQuery.isError },
    acknowledgedVersion,
  );

  useEffect(() => {
    if (cleared) clearLoginNotice();
  }, [cleared, clearLoginNotice]);

  if (!status || !shouldShowLoginNotice(status, acknowledgedVersion)) return null;

  const handleAcknowledge = () => {
    setAcknowledgedVersion(status.version);
    acknowledgeMutation.mutate({ version: status.version });
  };

  return (
    <Dialog open>
      <DialogContent
        className="max-w-md"
        data-testid="login-notice-modal"
        onEscapeKeyDown={preventClose}
        onPointerDownOutside={preventClose}
        onInteractOutside={preventClose}
      >
        <DialogHeader>
          <DialogTitle>Before you continue</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <DialogDescription asChild>
            <p className="whitespace-pre-line text-sm text-[#4a463f]">{status.text}</p>
          </DialogDescription>
        </DialogBody>
        <DialogFooter>
          <Button data-testid="login-notice-acknowledge" onClick={handleAcknowledge}>
            I understand
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
