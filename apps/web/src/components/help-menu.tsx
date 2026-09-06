"use client";

import { useEffect, useRef, useState } from "react";
import { HelpCircle, Info } from "lucide-react";
import { expandAboutLinkUrl, helpMenuAboutLinks, isExternalAboutLink } from "@rbrasier/domain";
import { APP_VERSION } from "@/lib/app-version";
import { trpc } from "@/trpc/client";
import { AboutModal } from "./about-modal";
import { ABOUT_LINK_ICON_COMPONENTS } from "./about-link-icons";

// Lives in the sidebar's brand row, sitting beside the ALPHA badge rather than
// floating over page content in the viewport corner. `className` is how the
// rail positions it; the menu itself anchors to the trigger.
export function HelpMenu({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const aboutLinksQuery = trpc.settings.getAboutLinks.useQuery();
  // Only entries an admin flagged for the menu; the rest live on the About modal.
  const menuLinks = aboutLinksQuery.data ? helpMenuAboutLinks(aboutLinksQuery.data) : [];

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <>
      <div ref={menuRef} className={`relative ${className ?? ""}`}>
        <button
          type="button"
          aria-label="Help"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((previous) => !previous)}
          // Weighted to match the ALPHA badge it sits beside: hairline border,
          // muted glyph, no fill and no elevation.
          className="flex h-[20px] w-[20px] items-center justify-center rounded-[4px] border border-[#dedad2] text-[#736d5f] transition-colors hover:bg-[#efece5] hover:text-[#1c1b19]"
        >
          <HelpCircle className="h-[12px] w-[12px]" />
        </button>

        {open && (
          <div
            role="menu"
            className="absolute right-0 top-full z-30 mt-1 w-52 rounded-[9px] border border-[#e7e3db] bg-white py-1 shadow-wf-md"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setAboutOpen(true);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-[#1c1b19] hover:bg-[#f5f3ee]"
            >
              <Info className="h-[14px] w-[14px] shrink-0 text-[#5c574c]" />
              About
            </button>

            {menuLinks.map((link) => {
              const Icon = ABOUT_LINK_ICON_COMPONENTS[link.icon];
              const isExternal = isExternalAboutLink(link.url);
              return (
                <a
                  key={`${link.label}-${link.url}`}
                  role="menuitem"
                  href={expandAboutLinkUrl(link.url, APP_VERSION)}
                  {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  onClick={() => setOpen(false)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-[#1c1b19] hover:bg-[#f5f3ee]"
                >
                  <Icon className="h-[14px] w-[14px] shrink-0 text-[#5c574c]" />
                  {link.label}
                </a>
              );
            })}
          </div>
        )}
      </div>

      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </>
  );
}
