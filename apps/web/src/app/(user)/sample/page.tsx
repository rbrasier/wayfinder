"use client";

import type { SampleResponse } from "@rbrasier/shared";
import { useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/trpc/client";

type Phase = "idle" | "streaming" | "done" | "error";

export default function SamplePage() {
  const [prompt, setPrompt] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [partial, setPartial] = useState<Partial<SampleResponse>>({});
  const [error, setError] = useState<string | null>(null);
  const [showRationale, setShowRationale] = useState(false);

  const sendMutation = trpc.message.send.useMutation();
  const logErrorMutation = trpc.error.log.useMutation();

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!prompt.trim()) return;
    setPhase("streaming");
    setPartial({});
    setError(null);

    try {
      const iter = await sendMutation.mutateAsync({ prompt });
      // tRPC v11 async-generator mutations resolve to an AsyncIterable when
      // using httpBatchStreamLink. Iterate to receive partial → final.
      for await (const evt of iter as AsyncIterable<
        | { type: "meta"; conversationId: string }
        | { type: "partial"; partial: Partial<SampleResponse> }
        | { type: "final"; object: SampleResponse }
      >) {
        if (evt.type === "partial") setPartial(evt.partial);
        if (evt.type === "final") setPartial(evt.object);
      }
      setPhase("done");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      setPhase("error");
      void logErrorMutation.mutateAsync({
        level: "error",
        message,
        page: "/sample",
        stack: caught instanceof Error ? caught.stack ?? null : null,
      });
    }
  };

  return (
    <main className="container max-w-2xl py-12">
      <Card>
        <CardHeader>
          <CardTitle>Ask me anything</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <form onSubmit={onSubmit} className="flex gap-2">
            <Input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="What's the capital of France?"
              disabled={phase === "streaming"}
            />
            <Button type="submit" disabled={phase === "streaming" || !prompt.trim()}>
              {phase === "streaming" ? "Thinking…" : "Send"}
            </Button>
          </form>

          {(partial.response || phase === "streaming") && (
            <section className="space-y-3">
              <p className="whitespace-pre-wrap text-sm leading-relaxed">
                {partial.response ?? <span className="text-muted-foreground">…</span>}
              </p>

              {typeof partial.confidence === "number" && (
                <Badge variant={partial.confidence >= 70 ? "default" : "secondary"}>
                  Confidence: {partial.confidence}/100
                </Badge>
              )}

              {partial.rationale && (
                <div className="rounded-md border p-3 text-sm">
                  <button
                    type="button"
                    className="font-medium underline-offset-4 hover:underline"
                    onClick={() => setShowRationale((v) => !v)}
                  >
                    {showRationale ? "Hide" : "Show"} rationale
                  </button>
                  {showRationale && (
                    <p className="mt-2 text-muted-foreground">{partial.rationale}</p>
                  )}
                </div>
              )}
            </section>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
            >
              {error}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
