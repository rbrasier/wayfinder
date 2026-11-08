"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SignaturePad } from "@/components/signatures/signature-pad";
import { trpc } from "@/trpc/client";

// The user's remembered drawn signature (ADR-067 §2). Shown only when the
// install signs with drawings; redrawing never changes documents already signed,
// because each decision froze the drawing it used.
export function DrawnSignatureCard() {
  const capabilities = trpc.settings.getSignatureCapabilities.useQuery();
  const drawing = trpc.user.getDrawnSignature.useQuery();
  const [redrawing, setRedrawing] = useState(false);

  if (capabilities.data?.method === "attestation" || !capabilities.data) return null;

  return (
    <Card data-testid="drawn-signature-card">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Your signature</CardTitle>
        {drawing.data && !redrawing && (
          <Button size="sm" variant="outline" onClick={() => setRedrawing(true)}>
            Redraw signature
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {drawing.data && !redrawing ? (
          <>
            <img
              src={drawing.data.dataUrl}
              alt="Your saved signature"
              className="h-20 w-auto rounded border border-[#f0ede8] bg-white p-1"
            />
            <p className="text-xs text-muted-foreground">
              Placed on documents you approve. Documents you have already signed keep the signature they were
              signed with.
            </p>
          </>
        ) : (
          <SignaturePad onSaved={() => setRedrawing(false)} />
        )}
      </CardContent>
    </Card>
  );
}
