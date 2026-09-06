"use client";

import { expandAboutLinkUrl, isExternalAboutLink, type AboutLink } from "@rbrasier/domain";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { APP_VERSION } from "@/lib/app-version";
import { trpc } from "@/trpc/client";
import { ABOUT_LINK_ICON_COMPONENTS } from "./about-link-icons";

function AboutLinkButton({ link }: { link: AboutLink }) {
  const Icon = ABOUT_LINK_ICON_COMPONENTS[link.icon];
  const isExternal = isExternalAboutLink(link.url);

  return (
    <a
      href={expandAboutLinkUrl(link.url, APP_VERSION)}
      {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="flex items-center gap-2 rounded-[8px] border border-[#e7e3db] bg-white px-3 py-2 text-[13px] font-medium text-[#1c1b19] transition-colors hover:border-[#2f56d3] hover:bg-[#eaeefb] hover:text-[#2f56d3]"
    >
      <Icon className="h-[14px] w-[14px] shrink-0 text-[#666055]" />
      {link.label}
    </a>
  );
}

export function AboutModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const aboutLinksQuery = trpc.settings.getAboutLinks.useQuery(undefined, { enabled: open });
  const links = aboutLinksQuery.data?.links ?? [];

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>About Wayfinder</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="flex items-center gap-3">
            <div className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[11px] bg-[#2f56d3] text-[18px] font-bold text-white">
              W
            </div>
            <div>
              <p className="text-[14px] font-semibold text-[#1c1b19]">Wayfinder</p>
              <p className="font-mono text-[12px] text-[#666055]">Version {APP_VERSION}</p>
            </div>
          </div>

          <p className="text-[13px] leading-[1.55] text-[#5c574c]">
            Wayfinder is an AI-guided workflow agent for document-heavy processes. It walks you
            through a defined process step by step, gathering what it needs, producing the documents
            the process calls for, and recording confidence and an audit trail as it goes.
          </p>

          {links.length > 0 && (
            <div className="flex flex-wrap gap-2 border-t border-[#e7e3db] pt-3">
              {links.map((link) => (
                <AboutLinkButton key={`${link.label}-${link.url}`} link={link} />
              ))}
            </div>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
