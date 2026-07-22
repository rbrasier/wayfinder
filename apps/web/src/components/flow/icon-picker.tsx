"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";

// A searchable emoji set for flow icons. Each entry pairs the glyph with a few
// keywords so a plain-language search ("money", "law", "people") surfaces it.
// Deliberately broad but hand-curated — kept in-repo so the picker needs no
// network access and renders identically in every environment.
interface IconEntry {
  icon: string;
  keywords: string;
}

const ICON_LIBRARY: IconEntry[] = [
  { icon: "🗂️", keywords: "folder files organise archive documents" },
  { icon: "🏗️", keywords: "build construction project setup" },
  { icon: "💬", keywords: "chat conversation message talk" },
  { icon: "📋", keywords: "clipboard checklist tasks form" },
  { icon: "🔄", keywords: "cycle refresh process loop repeat" },
  { icon: "⚙️", keywords: "settings config gear cog process" },
  { icon: "📝", keywords: "note write edit memo draft" },
  { icon: "📄", keywords: "document page paper file" },
  { icon: "📑", keywords: "bookmark tabs sections document" },
  { icon: "📊", keywords: "chart report analytics data stats" },
  { icon: "📈", keywords: "growth increase chart trend up" },
  { icon: "📉", keywords: "decrease chart trend down" },
  { icon: "🗃️", keywords: "card box records file archive" },
  { icon: "🗄️", keywords: "cabinet storage archive files" },
  { icon: "📁", keywords: "folder directory files" },
  { icon: "📂", keywords: "folder open directory files" },
  { icon: "✅", keywords: "check done complete approve tick" },
  { icon: "☑️", keywords: "checkbox done complete select" },
  { icon: "🔖", keywords: "bookmark tag label save" },
  { icon: "🏷️", keywords: "label tag price category" },
  { icon: "💼", keywords: "briefcase work business job" },
  { icon: "🧾", keywords: "receipt invoice bill expense accounting" },
  { icon: "💰", keywords: "money finance budget cash funds" },
  { icon: "💵", keywords: "money dollar cash payment" },
  { icon: "💳", keywords: "card payment credit finance" },
  { icon: "🏦", keywords: "bank finance money institution" },
  { icon: "⚖️", keywords: "law legal balance justice compliance" },
  { icon: "📜", keywords: "scroll contract policy terms legal" },
  { icon: "🖋️", keywords: "sign pen signature approve" },
  { icon: "✍️", keywords: "write sign author signature" },
  { icon: "🔍", keywords: "search find review inspect audit" },
  { icon: "🔎", keywords: "search find magnify inspect" },
  { icon: "🔐", keywords: "security lock secure key access" },
  { icon: "🔒", keywords: "lock secure private protect" },
  { icon: "🛡️", keywords: "shield security protect defend safety" },
  { icon: "🚀", keywords: "launch start rocket ship fast" },
  { icon: "🎯", keywords: "target goal objective aim focus" },
  { icon: "🧭", keywords: "compass navigate direction wayfinder guide" },
  { icon: "🗺️", keywords: "map plan route journey" },
  { icon: "📌", keywords: "pin location important mark" },
  { icon: "📍", keywords: "location place pin marker" },
  { icon: "🗓️", keywords: "calendar date schedule plan" },
  { icon: "📅", keywords: "calendar date schedule deadline" },
  { icon: "⏰", keywords: "clock time alarm reminder deadline" },
  { icon: "⏳", keywords: "hourglass wait time pending" },
  { icon: "🔔", keywords: "bell notify alert reminder" },
  { icon: "📣", keywords: "announce megaphone broadcast marketing" },
  { icon: "📢", keywords: "announce loud broadcast marketing" },
  { icon: "✉️", keywords: "email mail message envelope send" },
  { icon: "📧", keywords: "email mail message send" },
  { icon: "📨", keywords: "email incoming mail message" },
  { icon: "📮", keywords: "mailbox post send submit" },
  { icon: "☎️", keywords: "phone call contact support" },
  { icon: "📞", keywords: "phone call contact support" },
  { icon: "👥", keywords: "people team group users members" },
  { icon: "👤", keywords: "person user profile individual" },
  { icon: "🧑‍💼", keywords: "professional office worker staff employee" },
  { icon: "🤝", keywords: "deal agreement partnership handshake onboarding" },
  { icon: "🧑‍⚖️", keywords: "judge legal law compliance" },
  { icon: "🧑‍💻", keywords: "developer engineer tech coder it" },
  { icon: "🏢", keywords: "office building company organisation corporate" },
  { icon: "🏛️", keywords: "government institution bank court public" },
  { icon: "🏭", keywords: "factory manufacturing industry production" },
  { icon: "🏬", keywords: "store shop retail department" },
  { icon: "🛒", keywords: "cart shopping procurement purchase buy" },
  { icon: "📦", keywords: "package box delivery shipping product" },
  { icon: "🚚", keywords: "delivery truck logistics shipping transport" },
  { icon: "🧰", keywords: "toolbox tools maintenance repair kit" },
  { icon: "🛠️", keywords: "tools build fix maintenance repair" },
  { icon: "🔧", keywords: "wrench fix tool repair maintenance" },
  { icon: "🧩", keywords: "puzzle piece integration solution module" },
  { icon: "💡", keywords: "idea insight lightbulb innovation tip" },
  { icon: "🧠", keywords: "brain ai think intelligence smart" },
  { icon: "🤖", keywords: "robot ai automation bot agent" },
  { icon: "⚡", keywords: "fast energy power quick action" },
  { icon: "🔥", keywords: "hot urgent priority trending" },
  { icon: "⭐", keywords: "star favourite important quality" },
  { icon: "🏆", keywords: "trophy win award success achievement" },
  { icon: "🎓", keywords: "education graduate training learn course" },
  { icon: "📚", keywords: "books knowledge library learning docs" },
  { icon: "📖", keywords: "book read guide manual documentation" },
  { icon: "🩺", keywords: "health medical doctor care diagnosis" },
  { icon: "🏥", keywords: "hospital health medical care clinic" },
  { icon: "🧪", keywords: "test experiment lab science research" },
  { icon: "🔬", keywords: "microscope research science analysis lab" },
  { icon: "🌐", keywords: "web internet global network world" },
  { icon: "🌍", keywords: "world global earth international" },
  { icon: "🔗", keywords: "link connect chain integration url" },
  { icon: "🧵", keywords: "thread sequence steps process" },
  { icon: "🪝", keywords: "hook webhook connect trigger" },
  { icon: "🗳️", keywords: "vote ballot decision approval governance" },
  { icon: "📤", keywords: "export send out upload share" },
  { icon: "📥", keywords: "import receive inbox download intake" },
  { icon: "🖥️", keywords: "computer desktop it system" },
  { icon: "💻", keywords: "laptop computer work tech" },
  { icon: "🗒️", keywords: "notepad notes list memo" },
  { icon: "🧮", keywords: "abacus calculate maths finance accounting" },
  { icon: "🪪", keywords: "id identity licence badge verify" },
  { icon: "🔑", keywords: "key access credential unlock permission" },
];

interface IconPickerProps {
  value: string;
  onChange: (icon: string) => void;
}

// An overlay icon browser: a "More…" trigger opens a searchable grid across the
// full ICON_LIBRARY. Dismisses on outside click or Escape.
export function IconPicker({ value, onChange }: IconPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    // Move focus to the search field on open without the autoFocus prop
    // (jsx-a11y/no-autofocus), matching the pattern used elsewhere in the app.
    searchRef.current?.focus();
    const handleClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return ICON_LIBRARY;
    return ICON_LIBRARY.filter(
      (entry) => entry.icon === needle || entry.keywords.includes(needle),
    );
  }, [query]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setQuery("");
          setOpen((prev) => !prev);
        }}
        className="text-[12px] font-medium text-[#3a5fd9] transition-colors hover:text-[#2e4bb0]"
      >
        More…
      </button>

      {open && (
        // Anchored to the bottom of the trigger (opening upward) so the panel
        // stays inside the dialog — DialogContent clips with overflow-hidden, and
        // the icon field is the last row, so a downward panel would be cut off.
        <div className="absolute left-0 bottom-full z-50 mb-1.5 w-[280px] rounded-[12px] border border-[#dedad2] bg-white p-2 shadow-[0_6px_24px_rgba(0,0,0,.14)]">
          <div className="relative mb-2">
            <Search
              size={13}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9a968f]"
            />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search icons…"
              className="h-8 w-full rounded-[8px] border border-[#dedad2] bg-[#f7f6f3] pl-7 pr-2 text-[12px] text-[#1a1814] focus:border-[#3a5fd9] focus:bg-white focus:outline-none"
            />
          </div>
          {results.length === 0 ? (
            <p className="px-2 py-4 text-center text-[12px] text-[#6d6a65]">No icons match “{query}”.</p>
          ) : (
            <div className="grid max-h-[200px] grid-cols-7 gap-1 overflow-y-auto">
              {results.map((entry) => (
                <button
                  key={entry.icon}
                  type="button"
                  aria-label={entry.keywords.split(" ")[0]}
                  onClick={() => {
                    onChange(entry.icon);
                    setOpen(false);
                  }}
                  className={`flex h-8 w-8 items-center justify-center rounded-[8px] text-lg transition-colors ${
                    value === entry.icon ? "bg-[#eef1fc] ring-1 ring-[#3a5fd9]" : "hover:bg-[#efede8]"
                  }`}
                >
                  {entry.icon}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
