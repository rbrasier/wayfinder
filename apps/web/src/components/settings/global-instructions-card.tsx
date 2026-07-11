"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/trpc/client";

export function GlobalInstructionsCard() {
  const query = trpc.settings.get.useQuery({ key: "global_prompt" });
  const setMutation = trpc.settings.set.useMutation({
    onSuccess: () => toast.success("Global AI instructions saved"),
    onError: () => toast.error("Failed to save global AI instructions"),
  });

  const [value, setValue] = useState("");

  useEffect(() => {
    if (query.data?.value !== undefined) {
      setValue(query.data.value);
    }
  }, [query.data?.value]);

  const handleSave = () => {
    setMutation.mutate({ key: "global_prompt", value: value.trim() });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Global AI Instructions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="global-prompt">Organisation-wide guidance</Label>
          <p className="text-xs text-muted-foreground">
            Added to every session&apos;s system prompt across all flows — use it for house
            style, tone, or spelling (e.g. &ldquo;Be matter-of-fact and professional. Use
            Australian English spelling.&rdquo;). Leave blank for none.
          </p>
          <Textarea
            id="global-prompt"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="e.g. Be matter-of-fact and professional. Use Australian English spelling."
            rows={4}
            disabled={query.isLoading}
          />
        </div>
        <Button onClick={handleSave} disabled={setMutation.isPending || query.isLoading}>
          {setMutation.isPending ? "Saving…" : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}
