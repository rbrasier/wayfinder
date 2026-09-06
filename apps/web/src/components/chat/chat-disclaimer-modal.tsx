"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { trpc } from "@/trpc/client";
import {
  rememberDisclaimerAcknowledgement,
  shouldOpenDisclaimerModal,
  type AcknowledgementStorage,
} from "./chat-disclaimer-state";
import { chatDisclaimerAcknowledgementKey } from "@rbrasier/domain";

const browserStorage = (): AcknowledgementStorage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

interface ChatDisclaimerModalProps {
  sessionId: string;
  userId: string;
}

export function ChatDisclaimerModal({ sessionId, userId }: ChatDisclaimerModalProps) {
  const disclaimerQuery = trpc.settings.getChatDisclaimer.useQuery(undefined, {
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const config = disclaimerQuery.data ?? null;
  const [open, setOpen] = useState(false);

  // The decision waits for the config and for the browser, because localStorage
  // does not exist during the server render — opening on the server would flash
  // the modal at a user who has already acknowledged it.
  useEffect(() => {
    if (!config) return;
    setOpen(shouldOpenDisclaimerModal(config, userId, sessionId, browserStorage()));
  }, [config, sessionId, userId]);

  const handleAcknowledge = () => {
    if (config) {
      rememberDisclaimerAcknowledgement(
        browserStorage(),
        chatDisclaimerAcknowledgementKey(config, userId, sessionId),
      );
    }
    setOpen(false);
  };

  if (!config) return null;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && handleAcknowledge()}>
      <DialogContent className="max-w-md" data-testid="chat-disclaimer-modal">
        <DialogHeader>
          <DialogTitle>Before you begin</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <p className="whitespace-pre-line text-sm text-[#4a463f]">{config.modalText}</p>
        </DialogBody>
        <DialogFooter>
          <Button data-testid="chat-disclaimer-acknowledge" onClick={handleAcknowledge}>
            I understand
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
