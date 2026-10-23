"use client";

import { useState } from "react";
import type { EmailRecipient } from "@rbrasier/domain";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/trpc/client";
import { recipientSuggestions, type RecipientSuggestion } from "./recipient-suggestions";
import { INVALID_OUTLINE } from "@/components/ui/field-problem";

interface RecipientAutosuggestProps {
  id: string;
  // The id of a save problem about recipients, which the box then points to.
  describedBy?: string;
  groups: Array<{ id: string; name: string }>;
  onAdd: (recipient: EmailRecipient, name: string) => void;
}

// One box for every kind of recipient (ADR-065 §4): people from the directory
// and groups appear as the author types, and any full address can be added —
// Enter takes the highlighted suggestion.
export function RecipientAutosuggest({
  id,
  describedBy,
  groups,
  onAdd,
}: RecipientAutosuggestProps) {
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const trimmed = query.trim();
  const people = trpc.people.search.useQuery(
    { query: trimmed, limit: 8 },
    { enabled: trimmed.length >= 2 },
  );
  const suggestions = recipientSuggestions(query, people.data ?? [], groups);
  const listId = `${id}-suggestions`;

  const choose = (suggestion: RecipientSuggestion) => {
    onAdd(suggestion.recipient, suggestion.label.replace(/^Add /, ""));
    setQuery("");
    setHighlighted(0);
  };

  return (
    <div className="space-y-1">
      <Label htmlFor={id}>Add a person, group or email address</Label>
      <Input
        id={id}
        role="combobox"
        aria-expanded={suggestions.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={describedBy ? true : undefined}
        aria-describedby={describedBy}
        className={INVALID_OUTLINE}
        aria-activedescendant={suggestions.length > 0 ? `${listId}-${highlighted}` : undefined}
        value={query}
        autoComplete="off"
        placeholder="Start typing a name, group or address…"
        onChange={(event) => {
          setQuery(event.target.value);
          setHighlighted(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setHighlighted((current) => Math.min(current + 1, suggestions.length - 1));
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setHighlighted((current) => Math.max(current - 1, 0));
          }
          if (event.key === "Enter" && suggestions[highlighted]) {
            event.preventDefault();
            choose(suggestions[highlighted]);
          }
          if (event.key === "Escape") setQuery("");
        }}
      />
      {suggestions.length > 0 && (
        <div
          id={listId}
          role="listbox"
          aria-label="Suggested recipients"
          className="max-h-48 overflow-y-auto rounded-[9px] border border-[#e7e3db] bg-white"
        >
          {suggestions.map((suggestion, index) => (
            <div
              key={`${suggestion.detail}-${suggestion.label}`}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === highlighted}
              tabIndex={-1}
              className={`flex cursor-pointer flex-col px-3 py-2 text-[13px] ${
                index === highlighted ? "bg-[#f5f3ee]" : "hover:bg-[#f7f8fc]"
              }`}
              onMouseDown={(event) => {
                event.preventDefault();
                choose(suggestion);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") choose(suggestion);
              }}
            >
              <span className="font-medium text-[#1c1b19]">{suggestion.label}</span>
              <span className="text-[11.5px] text-[#666055]">{suggestion.detail}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
