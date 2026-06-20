"use client";

import { useEffect, useRef, useState } from "react";
import { Github, HelpCircle, MessageSquarePlus } from "lucide-react";

export const GITHUB_ISSUES_URL = "https://github.com/rbrasier/wayfinder/issues";
export const DEFAULT_CONTACT_FORM_URL = "https://forms.gle/QWZQEnFViErRZSNU8";

// NEXT_PUBLIC_ vars are inlined at build time, so the override is read from the
// static reference rather than dynamic process.env access.
export function resolveContactFormUrl(override: string | undefined): string {
  const trimmed = override?.trim();
  return trimmed ? trimmed : DEFAULT_CONTACT_FORM_URL;
}

const contactFormUrl = resolveContactFormUrl(process.env.NEXT_PUBLIC_CONTACT_FORM_URL);

export function HelpMenu() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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
    <div ref={menuRef} className="fixed right-3 top-3 z-30">
      <button
        type="button"
        aria-label="Help"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="flex h-8 w-8 items-center justify-center rounded-full border border-[#dedad2] bg-white text-[#5a5650] shadow-[0_1px_3px_rgba(0,0,0,.06)] transition-colors hover:bg-[#efede8] hover:text-[#1a1814]"
      >
        <HelpCircle className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 w-52 rounded-[9px] border border-[#dedad2] bg-white py-1 shadow-md"
        >
          <a
            role="menuitem"
            href={GITHUB_ISSUES_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-[#1a1814] hover:bg-[#efede8]"
          >
            <Github className="h-[14px] w-[14px] shrink-0 text-[#5a5650]" />
            Report an issue
          </a>
          <a
            role="menuitem"
            href={contactFormUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-[#1a1814] hover:bg-[#efede8]"
          >
            <MessageSquarePlus className="h-[14px] w-[14px] shrink-0 text-[#5a5650]" />
            Contact developers
          </a>
        </div>
      )}
    </div>
  );
}
