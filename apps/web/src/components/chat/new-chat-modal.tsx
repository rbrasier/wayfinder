"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Flow } from "@rbrasier/domain";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { trpc } from "@/trpc/client";

interface NewChatModalProps {
  open: boolean;
  onClose: () => void;
  publishedFlows: Flow[];
}

export function NewChatModal({ open, onClose, publishedFlows }: NewChatModalProps) {
  const router = useRouter();
  const utils = trpc.useUtils();

  const createMutation = trpc.session.create.useMutation({
    onSuccess: (session) => {
      void utils.session.list.invalidate();
      onClose();
      toast.success("Chat started");
      router.push(`/chats/${session.id}`);
    },
  });

  const handleStart = (flowId: string) => {
    createMutation.mutate({ flowId });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div>
            <div className="mb-[3px] text-[11px] font-semibold uppercase tracking-[0.05em] text-[#918d87]">
              New Chat Session
            </div>
            <DialogTitle>Choose a workflow</DialogTitle>
          </div>
          <DialogCloseButton />
        </DialogHeader>

        <DialogBody>
          <p className="text-[13.5px] leading-[1.55] text-[#5a5650]">
            Select the workflow you&apos;d like to run. The agent will guide you through each step.
          </p>

          {publishedFlows.length === 0 ? (
            <p className="py-4 text-center text-[13px] text-[#918d87]">
              No published flows available. Publish one of your own flows or ask an admin to publish one for everyone.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-[10px] sm:grid-cols-2">
              {publishedFlows.map((flow) => (
                <button
                  key={flow.id}
                  type="button"
                  onClick={() => handleStart(flow.id)}
                  disabled={createMutation.isPending}
                  className="flex flex-col items-start gap-2 rounded-[10px] border-[1.5px] border-[#dedad2] p-[12px_14px] text-left transition-colors hover:border-[#c5d0f7] hover:bg-[#eef1fc] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <div className="flex items-center gap-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-[#eef1fc] text-[18px]">
                      {flow.icon ?? "💬"}
                    </div>
                    <span className="text-[13px] font-semibold text-[#1a1814]">{flow.name}</span>
                  </div>
                  {flow.description && (
                    <p className="line-clamp-2 text-[11px] leading-snug text-[#918d87]">
                      {flow.description}
                    </p>
                  )}
                  <span className="text-[10.5px] font-medium uppercase tracking-[0.04em] text-[#a8a39c]">
                    {flow.visibility.kind === "global" ? "Everyone" : "Only you"}
                  </span>
                  <span className="mt-auto text-[12px] font-semibold text-[#3a5fd9]">Start →</span>
                </button>
              ))}
            </div>
          )}

          {createMutation.error && (
            <p className="text-[13px] text-[#c2385a]">{createMutation.error.message}</p>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
