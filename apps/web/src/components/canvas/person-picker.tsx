"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/trpc/client";

export interface PickedPerson {
  userId: string | null;
  email: string;
  displayName: string | null;
}

interface PersonPickerProps {
  id: string;
  label: string;
  placeholder?: string;
  onPick: (person: PickedPerson) => void;
}

// A search-as-you-type picker over the federated people directory (accounts,
// Entra, the HR upload). A result without an account still carries an email,
// which callers may accept as a plain address.
export function PersonPicker({ id, label, placeholder, onPick }: PersonPickerProps) {
  const [query, setQuery] = useState("");
  const trimmed = query.trim();
  const results = trpc.people.search.useQuery(
    { query: trimmed, limit: 8 },
    { enabled: trimmed.length >= 2 },
  );

  const pick = (person: PickedPerson) => {
    onPick(person);
    setQuery("");
  };

  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={placeholder ?? "Search by name or email…"}
        autoComplete="off"
      />
      {trimmed.length >= 2 && (results.data ?? []).length > 0 && (
        <ul className="max-h-48 overflow-y-auto rounded-[9px] border border-[#e7e3db] bg-white">
          {(results.data ?? []).map((person) => (
            <li key={`${person.source}-${person.email}`}>
              <button
                type="button"
                className="flex w-full flex-col items-start px-3 py-2 text-left text-[13px] hover:bg-[#f7f8fc]"
                onClick={() =>
                  pick({ userId: person.userId, email: person.email, displayName: person.displayName })
                }
              >
                <span className="font-medium text-[#1c1b19]">{person.displayName ?? person.email}</span>
                <span className="text-[11.5px] text-[#666055]">
                  {person.email}
                  {person.userId ? "" : " · no Wayfinder account"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
