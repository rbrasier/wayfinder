"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  ABOUT_LINK_ICONS,
  ABOUT_LINK_VERSION_PLACEHOLDER,
  DEFAULT_ISSUE_TRACKER_URL,
  type AboutLink,
  type AboutLinkIcon,
} from "@rbrasier/domain";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ABOUT_LINK_ICON_COMPONENTS, ABOUT_LINK_ICON_LABELS } from "@/components/about-link-icons";
import { trpc } from "@/trpc/client";

const MAX_LINKS = 12;

const blankLink = (): AboutLink => ({
  label: "",
  url: "",
  icon: "link",
  showInHelpMenu: false,
});

export function AboutLinksCard() {
  const utils = trpc.useUtils();
  const query = trpc.settings.getAboutLinks.useQuery();
  const [links, setLinks] = useState<AboutLink[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!query.data) return;
    setLinks(query.data.links);
  }, [query.data]);

  const mutation = trpc.settings.setAboutLinks.useMutation({
    onSuccess: async () => {
      setError(null);
      toast.success("About links saved");
      await utils.settings.getAboutLinks.invalidate();
    },
    onError: (mutationError) => {
      setError(mutationError.message);
      toast.error("Failed to save About links");
    },
  });

  const updateLink = (index: number, patch: Partial<AboutLink>) =>
    setLinks((previous) =>
      previous.map((link, position) => (position === index ? { ...link, ...patch } : link)),
    );

  const removeLink = (index: number) =>
    setLinks((previous) => previous.filter((_, position) => position !== index));

  const handleSave = () =>
    mutation.mutate({
      links: links.map((link) => ({
        label: link.label.trim(),
        url: link.url.trim(),
        icon: link.icon,
        showInHelpMenu: link.showInHelpMenu,
      })),
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">About</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Links shown as buttons at the bottom of the About modal. Tick &ldquo;Help menu&rdquo; to
          also list one under the help (?) button in the top right. A URL may contain{" "}
          <code className="rounded-[4px] bg-[#f0ede7] px-1 py-0.5 font-mono text-xs">
            {ABOUT_LINK_VERSION_PLACEHOLDER}
          </code>
          , which is replaced with the running app version when the link is opened.
        </p>

        {links.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No links configured — the About modal shows app information only.
          </p>
        )}

        <div className="space-y-3">
          {links.map((link, index) => {
            const Icon = ABOUT_LINK_ICON_COMPONENTS[link.icon];
            return (
              <div
                key={index}
                data-testid="about-link-row"
                className="space-y-2 rounded-[10px] border border-[#e4e1db] p-3"
              >
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 shrink-0 text-[#666055]" />
                  <Input
                    aria-label={`Link text ${index + 1}`}
                    value={link.label}
                    onChange={(event) => updateLink(index, { label: event.target.value })}
                    placeholder="Report an issue"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove link ${index + 1}`}
                    onClick={() => removeLink(index)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                <Input
                  aria-label={`Link URL ${index + 1}`}
                  value={link.url}
                  onChange={(event) => updateLink(index, { url: event.target.value })}
                  placeholder={DEFAULT_ISSUE_TRACKER_URL}
                />

                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`about-link-icon-${index}`} className="text-xs">
                      Icon
                    </Label>
                    <select
                      id={`about-link-icon-${index}`}
                      value={link.icon}
                      onChange={(event) =>
                        updateLink(index, { icon: event.target.value as AboutLinkIcon })
                      }
                      className="h-9 rounded-[8px] border border-[#e7e3db] bg-white px-2 text-[13px]"
                    >
                      {ABOUT_LINK_ICONS.map((icon) => (
                        <option key={icon} value={icon}>
                          {ABOUT_LINK_ICON_LABELS[icon]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      id={`about-link-help-${index}`}
                      type="checkbox"
                      className="h-4 w-4"
                      checked={link.showInHelpMenu}
                      onChange={(event) =>
                        updateLink(index, { showInHelpMenu: event.target.checked })
                      }
                    />
                    <Label htmlFor={`about-link-help-${index}`} className="text-xs">
                      Show in help menu
                    </Label>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="about-link-add"
            disabled={links.length >= MAX_LINKS}
            onClick={() => setLinks((previous) => [...previous, blankLink()])}
          >
            <Plus className="mr-1 h-4 w-4" />
            Add link
          </Button>
          <Button
            type="button"
            data-testid="about-links-save"
            onClick={handleSave}
            disabled={mutation.isPending || query.isLoading}
          >
            {mutation.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
