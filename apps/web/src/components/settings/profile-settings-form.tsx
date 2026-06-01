"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/trpc/client";

export function ProfileSettingsForm() {
  const utils = trpc.useUtils();
  const meQuery = trpc.user.me.useQuery();

  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [team, setTeam] = useState("");

  useEffect(() => {
    if (!meQuery.data) return;
    setName(meQuery.data.name ?? "");
    setRole(meQuery.data.role ?? "");
    setTeam(meQuery.data.team ?? "");
  }, [meQuery.data]);

  const updateMutation = trpc.user.updateProfile.useMutation({
    onSuccess: () => {
      void utils.user.me.invalidate();
      toast.success("Profile updated");
    },
    onError: (error) => toast.error(error.message),
  });

  const handleSave = () => {
    updateMutation.mutate({
      name: name.trim() === "" ? null : name.trim(),
      role: role.trim() === "" ? null : role.trim(),
      team: team.trim() === "" ? null : team.trim(),
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Profile</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Your full name, role, and team are shared with the assistant in every chat so it can
          tailor its guidance to you.
        </p>

        <div className="space-y-1.5">
          <Label htmlFor="profile-name">Full name</Label>
          <Input
            id="profile-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ada Lovelace"
            disabled={meQuery.isLoading}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="profile-role">Role</Label>
          <Input
            id="profile-role"
            value={role}
            onChange={(event) => setRole(event.target.value)}
            placeholder="Underwriting Manager"
            disabled={meQuery.isLoading}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="profile-team">Team</Label>
          <Input
            id="profile-team"
            value={team}
            onChange={(event) => setTeam(event.target.value)}
            placeholder="Commercial Lines"
            disabled={meQuery.isLoading}
          />
        </div>

        {meQuery.data?.email && (
          <div className="space-y-1.5">
            <Label htmlFor="profile-email">Email</Label>
            <Input id="profile-email" value={meQuery.data.email} disabled readOnly />
          </div>
        )}

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={updateMutation.isPending || meQuery.isLoading}>
            {updateMutation.isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
