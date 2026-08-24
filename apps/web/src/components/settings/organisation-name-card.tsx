"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/trpc/client";

// `onValueChange` lets the first-run wizard save the field when the admin clicks
// Continue without having pressed Save — the settings page passes nothing and
// keeps the Save-only behaviour.
export function OrganisationNameFields({
  onValueChange,
}: {
  onValueChange?: (value: string) => void;
}) {
  const orgNameQuery = trpc.settings.get.useQuery({ key: "organisation_name" });
  const setMutation = trpc.settings.set.useMutation({
    onSuccess: () => toast.success("Organisation name saved"),
    onError: () => toast.error("Failed to save organisation name"),
  });

  const [value, setValue] = useState("");

  useEffect(() => {
    if (orgNameQuery.data?.value !== undefined) {
      setValue(orgNameQuery.data.value);
      onValueChange?.(orgNameQuery.data.value);
    }
  }, [orgNameQuery.data?.value, onValueChange]);

  const handleChange = (next: string) => {
    setValue(next);
    onValueChange?.(next);
  };

  const handleSave = () => {
    setMutation.mutate({ key: "organisation_name", value: value.trim() });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="org-name">Organisation name</Label>
        <p className="text-xs text-muted-foreground">
          Used in AI system prompts to give the assistant context about your organisation.
        </p>
        <Input
          id="org-name"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="e.g. Acme Corporation"
          disabled={orgNameQuery.isLoading}
          // Password managers / autofill inject attributes (e.g. caret-color,
          // fdprocessedid) onto inputs after SSR, producing a benign dev-mode
          // hydration warning. Suppress it for this field only.
          suppressHydrationWarning
        />
      </div>
      <Button onClick={handleSave} disabled={setMutation.isPending || orgNameQuery.isLoading}>
        {setMutation.isPending ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}

// The first-run wizard shows the name on its own, without the organisations
// toggle — its deployment step already asks single-or-multiple, so a second
// switch there would contradict the choice the admin just made.
export function OrganisationNameCard({
  onValueChange,
}: {
  onValueChange?: (value: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">General</CardTitle>
      </CardHeader>
      <CardContent>
        <OrganisationNameFields onValueChange={onValueChange} />
      </CardContent>
    </Card>
  );
}
