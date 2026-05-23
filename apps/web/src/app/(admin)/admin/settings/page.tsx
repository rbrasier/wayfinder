"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/trpc/client";

function OrganisationNameCard() {
  const orgNameQuery = trpc.settings.get.useQuery({ key: "organisation_name" });
  const setMutation = trpc.settings.set.useMutation({
    onSuccess: () => toast.success("Organisation name saved"),
    onError: () => toast.error("Failed to save organisation name"),
  });

  const [value, setValue] = useState("");

  useEffect(() => {
    if (orgNameQuery.data?.value !== undefined) {
      setValue(orgNameQuery.data.value);
    }
  }, [orgNameQuery.data?.value]);

  const handleSave = () => {
    setMutation.mutate({ key: "organisation_name", value: value.trim() });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">General</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="org-name">Organisation name</Label>
          <p className="text-xs text-muted-foreground">
            Used in AI system prompts to give the assistant context about your organisation.
          </p>
          <Input
            id="org-name"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="e.g. Acme Legal"
            disabled={orgNameQuery.isLoading}
          />
        </div>
        <Button
          onClick={handleSave}
          disabled={setMutation.isPending || orgNameQuery.isLoading}
        >
          {setMutation.isPending ? "Saving…" : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}

export default function AppSettingsPage() {
  return (
    <div className="h-full overflow-auto">
      <div className="container py-8">
        <div className="space-y-6">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Application Settings</h1>
            <p className="text-sm text-muted-foreground">
              Configure global behaviour for this application.
            </p>
          </div>

          <div className="space-y-4">
            <OrganisationNameCard />

            <Card>
              <CardHeader>
                <CardTitle className="text-base">AI Provider</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Select the default AI provider and model used across the application.
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Email</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Configure the transactional email provider and sender address.
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Maintenance</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Enable maintenance mode to temporarily suspend access for non-admin users.
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
