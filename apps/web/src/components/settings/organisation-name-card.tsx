"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/trpc/client";

export function OrganisationNameCard() {
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
            // Password managers / autofill inject attributes (e.g. caret-color,
            // fdprocessedid) onto inputs after SSR, producing a benign dev-mode
            // hydration warning. Suppress it for this field only.
            suppressHydrationWarning
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
