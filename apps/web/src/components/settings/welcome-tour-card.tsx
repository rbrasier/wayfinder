"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/trpc/client";

export function WelcomeTourCard() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const restartMutation = trpc.user.restartWelcomeTour.useMutation({
    onSuccess: async () => {
      await utils.user.me.invalidate();
      toast.success("Welcome tour restarted");
      // The welcome modal lives in the (user) layout and reads the freshly
      // cleared stamp; My Chats is where a first sign-in lands.
      router.push("/chats");
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Welcome tour</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Replay the guided introduction you saw on your first sign-in: choose between starting a
          chat and building a flow, and walk through how flows work step by step.
        </p>
        <Button
          variant="outline"
          onClick={() => restartMutation.mutate()}
          disabled={restartMutation.isPending}
        >
          {restartMutation.isPending ? "Restarting…" : "Restart the welcome tour"}
        </Button>
      </CardContent>
    </Card>
  );
}
