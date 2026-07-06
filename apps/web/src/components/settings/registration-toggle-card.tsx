"use client";

import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { trpc } from "@/trpc/client";

export function RegistrationToggleCard() {
  const utils = trpc.useUtils();
  const query = trpc.settings.registrationEnabled.useQuery();
  const mutation = trpc.settings.setRegistrationEnabled.useMutation({
    onSuccess: async () => {
      toast.success("Registration setting saved");
      await utils.settings.registrationEnabled.invalidate();
    },
    onError: () => toast.error("Failed to save registration setting"),
  });

  const enabled = query.data?.enabled ?? true;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">User Registration</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          When enabled, anyone can create an account at <code>/register</code>. New users
          have no admin privileges. Turn this off in production once your team is set up.
        </p>
        <div className="flex items-center justify-between">
          <Label htmlFor="registration-enabled" className="flex-1">
            Allow public registration
          </Label>
          <input
            id="registration-enabled"
            type="checkbox"
            className="h-4 w-4"
            checked={enabled}
            disabled={query.isLoading || mutation.isPending}
            onChange={(e) => mutation.mutate({ enabled: e.target.checked })}
          />
        </div>
      </CardContent>
    </Card>
  );
}
