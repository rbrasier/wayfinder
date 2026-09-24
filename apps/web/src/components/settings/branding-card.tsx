"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { BRANDING_DISPLAY_NAME_MAX_LENGTH, DEFAULT_BRAND_PALETTE } from "@rbrasier/domain";
import { BrandName, BrandTile } from "@/components/branding/brand-mark";
import { brandMarkView } from "@/components/branding/brand-mark-model";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/trpc/client";
import { brandColourCheck, canSaveBranding, type BrandColourCheck } from "./branding-card-model";

const HEX_COLOUR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const LOGO_ACCEPT = "image/png,image/jpeg,image/webp";

function ContrastReadout({ check }: { check: BrandColourCheck }) {
  if (check.state === "default") {
    return <p className="text-xs text-muted-foreground">Blank uses Wayfinder blue.</p>;
  }
  if (check.state === "invalid") {
    return <p className="text-xs text-muted-foreground">{check.message}</p>;
  }
  if (check.state === "fail") {
    return (
      <p className="flex items-start gap-1.5 text-xs text-destructive" data-testid="branding-contrast">
        <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {check.message}
      </p>
    );
  }
  return (
    <p className="flex items-start gap-1.5 text-xs text-[#1f6b4d]" data-testid="branding-contrast">
      <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {check.label}
    </p>
  );
}

// Admin → Settings → Branding (ADR-060). The logo uploads straight to its route;
// name and colour save together through tRPC. Both refresh the router because
// the palette and the signed-out mark are rendered on the server.
export function BrandingCard() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const brandingQuery = trpc.settings.getBranding.useQuery();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [displayName, setDisplayName] = useState("");
  const [primaryColour, setPrimaryColour] = useState("");
  const [logoBusy, setLogoBusy] = useState(false);

  useEffect(() => {
    if (!brandingQuery.data) return;
    setDisplayName(brandingQuery.data.customDisplayName);
    setPrimaryColour(brandingQuery.data.primaryColour ?? "");
  }, [brandingQuery.data]);

  const refreshBranding = async () => {
    await utils.settings.getBranding.invalidate();
    router.refresh();
  };

  const saveMutation = trpc.settings.setBranding.useMutation({
    onSuccess: async () => {
      toast.success("Branding saved");
      await refreshBranding();
    },
    onError: (error) => toast.error(error.message ?? "Failed to save branding"),
  });

  const sendLogoRequest = async (init: RequestInit, successMessage: string) => {
    setLogoBusy(true);
    try {
      const response = await fetch("/api/branding/logo", init);
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? "The logo could not be saved.");
        return;
      }
      toast.success(successMessage);
      await refreshBranding();
    } catch {
      toast.error("The logo could not be saved. Please try again.");
    } finally {
      setLogoBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleLogoChosen = (file: File | undefined) => {
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    void sendLogoRequest({ method: "POST", body: formData }, "Logo uploaded");
  };

  const handleLogoRemoved = () => void sendLogoRequest({ method: "DELETE" }, "Logo removed");

  const colourCheck = brandColourCheck(primaryColour);
  const canSave = canSaveBranding(displayName, colourCheck) && !saveMutation.isPending;
  const branding = brandingQuery.data;
  const previewView = brandMarkView(
    branding ? { ...branding, displayName: displayName.trim() || "Wayfinder" } : undefined,
  );
  const pickerValue = HEX_COLOUR_PATTERN.test(primaryColour) ? primaryColour : DEFAULT_BRAND_PALETTE.base;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Branding</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-muted-foreground">
          Your logo, name and colour, shown to everyone — in the sidebar, on the sign-in page and
          across the app. Leave them blank for the Wayfinder look.
        </p>

        <div className="space-y-2">
          <Label htmlFor="branding-logo">Logo</Label>
          <div className="flex items-center gap-3">
            <div
              className="flex items-center gap-[10px] rounded-[8px] border border-[#e7e3db] bg-[#faf9f7] px-3 py-2"
              data-testid="branding-preview"
            >
              <BrandTile view={previewView} size="auth" />
              <BrandName view={previewView} size="auth" />
            </div>
            <input
              ref={fileInputRef}
              id="branding-logo"
              data-testid="branding-logo-input"
              type="file"
              accept={LOGO_ACCEPT}
              className="sr-only"
              onChange={(event) => handleLogoChosen(event.target.files?.[0])}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={logoBusy || !branding}
              onClick={() => fileInputRef.current?.click()}
            >
              {logoBusy ? "Saving…" : branding?.logoVersion ? "Replace" : "Upload"}
            </Button>
            {branding?.logoVersion && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="branding-logo-remove"
                disabled={logoBusy}
                onClick={handleLogoRemoved}
              >
                Remove
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            PNG, JPEG or WebP, up to 512 KB. Shown square, so a simple mark works best. SVG
            isn&rsquo;t accepted.
          </p>
        </div>

        <div className="space-y-1">
          <Label htmlFor="branding-display-name">Display name</Label>
          <Input
            id="branding-display-name"
            data-testid="branding-display-name"
            value={displayName}
            maxLength={BRANDING_DISPLAY_NAME_MAX_LENGTH}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Wayfinder"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="branding-colour">Brand colour</Label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label="Brand colour picker"
              className="h-9 w-12 shrink-0 cursor-pointer rounded border border-input bg-transparent p-1"
              value={pickerValue}
              onChange={(event) => setPrimaryColour(event.target.value)}
            />
            <Input
              id="branding-colour"
              data-testid="branding-colour"
              value={primaryColour}
              onChange={(event) => setPrimaryColour(event.target.value)}
              placeholder={DEFAULT_BRAND_PALETTE.base}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={primaryColour.length === 0}
              onClick={() => setPrimaryColour("")}
            >
              Reset
            </Button>
          </div>
          <div role="status" aria-live="polite">
            <ContrastReadout check={colourCheck} />
          </div>
        </div>

        <div className="flex justify-end">
          <Button
            type="button"
            data-testid="branding-save"
            disabled={!canSave || brandingQuery.isLoading}
            onClick={() =>
              saveMutation.mutate({
                displayName,
                primaryColour: primaryColour.trim() || null,
              })
            }
          >
            {saveMutation.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
