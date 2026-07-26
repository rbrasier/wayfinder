"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  DEFAULT_SITE_BANNER_LINK_LABEL,
  SITE_BANNER_MAX_TEXT_SIZE_PT,
  SITE_BANNER_MIN_TEXT_SIZE_PT,
  createDefaultSiteBannerConfig,
  normaliseSiteBannerLinkUrl,
  resolveSiteBannerLinkLabel,
  type SiteBannerConfig,
} from "@rbrasier/domain";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useHydrated } from "@/components/site-banner";
import { trpc } from "@/trpc/client";

const HEX_COLOUR_PATTERN = /^#[0-9a-fA-F]{6}$/;

interface ColourFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}

function ColourField({ id, label, value, onChange }: ColourFieldProps) {
  // The native picker only understands valid hex, so it is fed a safe value
  // while the admin is mid-edit in the text input beside it.
  const pickerValue = HEX_COLOUR_PATTERN.test(value) ? value : "#000000";

  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          className="h-9 w-12 shrink-0 cursor-pointer rounded border border-input bg-transparent p-1"
          value={pickerValue}
          onChange={(e) => onChange(e.target.value)}
        />
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#dc2626"
        />
      </div>
    </div>
  );
}

function BannerPreview({ config }: { config: SiteBannerConfig }) {
  const text = config.text.trim().length > 0 ? config.text : "Your banner text will appear here";

  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">Preview</p>
      <div
        data-testid="site-banner-preview"
        className="flex items-center justify-center gap-3 overflow-hidden rounded border border-input px-4 py-1.5 text-center leading-tight"
        style={{
          backgroundColor: config.backgroundColour,
          color: config.textColour,
          fontSize: `${config.textSizePt}pt`,
        }}
      >
        <span className="min-w-0 truncate">{text}</span>
        {config.linkUrl.trim().length > 0 && (
          <span className="shrink-0 underline underline-offset-2">
            {resolveSiteBannerLinkLabel(config.linkLabel)}
          </span>
        )}
      </div>
    </div>
  );
}

export function SiteBannerCard() {
  const utils = trpc.useUtils();
  const bannerQuery = trpc.settings.getSiteBanner.useQuery();
  const saveMutation = trpc.settings.setSiteBanner.useMutation({
    onSuccess: async () => {
      toast.success("Site banner saved");
      await utils.settings.getSiteBanner.invalidate();
      setOpen(false);
    },
    onError: (error) => toast.error(error.message ?? "Failed to save the site banner"),
  });

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<SiteBannerConfig>(createDefaultSiteBannerConfig());
  const [textSizePt, setTextSizePt] = useState("12");
  const hydrated = useHydrated();

  // The root-layout banner shares this query key and starts fetching before
  // this card hydrates, so reading the cache during the first client render
  // would diverge from the server's "Loading…" markup. See useHydrated.
  const config = hydrated ? bannerQuery.data : undefined;

  useEffect(() => {
    if (!open || !config) return;
    setDraft(config);
    setTextSizePt(String(config.textSizePt));
  }, [open, config]);

  const updateDraft = (patch: Partial<SiteBannerConfig>) =>
    setDraft((current) => ({ ...current, ...patch }));

  const handleToggle = (enabled: boolean) => {
    if (!config) return;
    saveMutation.mutate({ ...config, enabled });
  };

  const handleSave = () => {
    const size = Number(textSizePt);
    if (!Number.isFinite(size) || !Number.isInteger(size)) {
      toast.error("Text size must be a whole number of points");
      return;
    }
    if (size < SITE_BANNER_MIN_TEXT_SIZE_PT || size > SITE_BANNER_MAX_TEXT_SIZE_PT) {
      toast.error(
        `Text size must be between ${SITE_BANNER_MIN_TEXT_SIZE_PT}pt and ${SITE_BANNER_MAX_TEXT_SIZE_PT}pt`,
      );
      return;
    }
    if (!HEX_COLOUR_PATTERN.test(draft.textColour)) {
      toast.error("Text colour must be a six-digit hex value, e.g. #dc2626");
      return;
    }
    if (!HEX_COLOUR_PATTERN.test(draft.backgroundColour)) {
      toast.error("Background colour must be a six-digit hex value, e.g. #ffffff");
      return;
    }
    const linkUrl = draft.linkUrl.trim();
    if (linkUrl.length > 0 && normaliseSiteBannerLinkUrl(linkUrl) !== linkUrl) {
      toast.error("Link must be a full https:// or http:// URL, or a path starting with /");
      return;
    }
    if (draft.enabled && draft.text.trim().length === 0) {
      toast.error("Add some banner text — an enabled banner with no text stays hidden");
      return;
    }
    saveMutation.mutate({ ...draft, textSizePt: size, linkUrl, linkLabel: draft.linkLabel.trim() });
  };

  const previewConfig: SiteBannerConfig = {
    ...draft,
    textSizePt: Number.isFinite(Number(textSizePt))
      ? Number(textSizePt)
      : createDefaultSiteBannerConfig().textSizePt,
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Site Banner</CardTitle>
        <Button
          size="sm"
          variant="outline"
          data-testid="site-banner-edit"
          onClick={() => setOpen(true)}
          disabled={!config}
        >
          Edit
        </Button>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          A single line across the top of every page — including the sign-in screen — for
          notifications and site warnings. Nobody can dismiss it; it stays until you switch it off.
        </p>
        {!config ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <Label htmlFor="site-banner-enabled" className="flex-1">
                Show the banner
              </Label>
              <input
                id="site-banner-enabled"
                data-testid="site-banner-enabled"
                type="checkbox"
                className="h-4 w-4"
                checked={config.enabled}
                disabled={saveMutation.isPending}
                onChange={(e) => handleToggle(e.target.checked)}
              />
            </div>
            <BannerPreview config={config} />
          </>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={(next) => !next && setOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit site banner</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="site-banner-draft-enabled" className="flex-1">
                Show the banner
              </Label>
              <input
                id="site-banner-draft-enabled"
                type="checkbox"
                className="h-4 w-4"
                checked={draft.enabled}
                onChange={(e) => updateDraft({ enabled: e.target.checked })}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="site-banner-text">Banner text</Label>
              <p className="text-xs text-muted-foreground">
                Kept to one centred line — anything longer is truncated rather than wrapped.
              </p>
              <Input
                id="site-banner-text"
                data-testid="site-banner-text"
                value={draft.text}
                maxLength={300}
                onChange={(e) => updateDraft({ text: e.target.value })}
                placeholder="Scheduled maintenance tonight from 8pm"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="site-banner-size">Text size (pt)</Label>
              <Input
                id="site-banner-size"
                data-testid="site-banner-size"
                value={textSizePt}
                onChange={(e) => setTextSizePt(e.target.value)}
                placeholder="12"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <ColourField
                id="site-banner-text-colour"
                label="Text colour"
                value={draft.textColour}
                onChange={(textColour) => updateDraft({ textColour })}
              />
              <ColourField
                id="site-banner-background-colour"
                label="Background colour"
                value={draft.backgroundColour}
                onChange={(backgroundColour) => updateDraft({ backgroundColour })}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="site-banner-link-url">Link (optional)</Label>
              <p className="text-xs text-muted-foreground">
                A full https:// or http:// URL, or a path starting with /. Leave blank for text
                only.
              </p>
              <Input
                id="site-banner-link-url"
                data-testid="site-banner-link-url"
                value={draft.linkUrl}
                onChange={(e) => updateDraft({ linkUrl: e.target.value })}
                placeholder="https://status.example.com"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="site-banner-link-label">Link text</Label>
              <Input
                id="site-banner-link-label"
                data-testid="site-banner-link-label"
                value={draft.linkLabel}
                maxLength={60}
                onChange={(e) => updateDraft({ linkLabel: e.target.value })}
                placeholder={DEFAULT_SITE_BANNER_LINK_LABEL}
              />
            </div>

            <BannerPreview config={previewConfig} />
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={saveMutation.isPending}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              data-testid="site-banner-save"
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
