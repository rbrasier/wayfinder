import type { EmailRecipient } from "@wayfinder/domain";

export interface DirectoryPerson {
  userId: string | null;
  email: string;
  displayName: string | null;
}

export interface RecipientSuggestion {
  label: string;
  detail: string;
  recipient: EmailRecipient;
}

const MIN_QUERY_LENGTH = 2;
const EMAIL_LIKE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The Email step's recipient box (ADR-065 §4): people and groups that match as
// the author types, and any full address they type even when nobody in the
// directory has it. The allowed-domain rule is checked on save, not here.
export const recipientSuggestions = (
  query: string,
  people: DirectoryPerson[],
  groups: Array<{ id: string; name: string }>,
): RecipientSuggestion[] => {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) return [];
  const needle = trimmed.toLowerCase();

  const matches = (text: string | null) => (text ?? "").toLowerCase().includes(needle);
  const personOptions: RecipientSuggestion[] = people
    .filter((person) => matches(person.displayName) || matches(person.email))
    .map((person) => ({
    label: person.displayName ?? person.email,
    detail: person.email,
    recipient: person.userId ? { kind: "user", userId: person.userId } : { kind: "address", email: person.email },
  }));
  const groupOptions: RecipientSuggestion[] = groups
    .filter((group) => matches(group.name))
    .map((group) => ({ label: group.name, detail: "Group", recipient: { kind: "group", groupId: group.id } }));

  const typedIsListed = people.some((person) => person.email.toLowerCase() === needle);
  const typedAddress: RecipientSuggestion[] =
    EMAIL_LIKE.test(trimmed) && !typedIsListed
      ? [{ label: `Add ${trimmed}`, detail: "Email address", recipient: { kind: "address", email: trimmed } }]
      : [];

  return [...typedAddress, ...personOptions, ...groupOptions];
};
