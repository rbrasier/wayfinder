"use client";

import { useRouter } from "next/navigation";
import type { Flow } from "@rbrasier/domain";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
          <DialogTitle>New Chat</DialogTitle>
        </DialogHeader>
        {publishedFlows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No published flows available. Ask an admin to publish a flow.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {publishedFlows.map((flow) => (
              <button
                key={flow.id}
                type="button"
                onClick={() => handleStart(flow.id)}
                disabled={createMutation.isPending}
                className="flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <div className="flex w-full items-center gap-2">
                  <span className="text-2xl">{flow.icon ?? "💬"}</span>
                  <span className="font-medium text-sm">{flow.name}</span>
                </div>
                {flow.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2">{flow.description}</p>
                )}
                <span className="mt-auto text-xs font-medium text-indigo-600">Start →</span>
              </button>
            ))}
          </div>
        )}
        {createMutation.error && (
          <p className="text-sm text-destructive">{createMutation.error.message}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
