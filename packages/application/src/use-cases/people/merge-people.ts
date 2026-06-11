import type { Person } from "@rbrasier/domain";

// Higher rank wins when the same email appears in more than one source. A record
// already tied to an account beats one that is not; Entra beats the HR upload;
// a free-typed email is the weakest.
const rank = (person: Person): number => {
  if (person.userId) return 3;
  if (person.source === "entra") return 2;
  if (person.source === "hr") return 1;
  return 0;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isEmailAddress = (value: string): boolean => EMAIL_PATTERN.test(value.trim());

// Merges results from several directories, de-duplicating by lowercased email
// and keeping the highest-ranked record for each address.
export const mergePeople = (lists: Person[][], limit: number): Person[] => {
  const byEmail = new Map<string, Person>();
  for (const list of lists) {
    for (const person of list) {
      const key = person.email.trim().toLowerCase();
      if (!key) continue;
      const existing = byEmail.get(key);
      if (!existing || rank(person) > rank(existing)) byEmail.set(key, person);
    }
  }
  return [...byEmail.values()].slice(0, limit);
};

// The free-text escape hatch: when the operator typed a bare email that no source
// returned, surface it as a pickable candidate so any address can be approved to.
export const appendTypedEmail = (people: Person[], query: string): Person[] => {
  const trimmed = query.trim();
  if (!isEmailAddress(trimmed)) return people;
  const key = trimmed.toLowerCase();
  if (people.some((person) => person.email.trim().toLowerCase() === key)) return people;
  const typed: Person = {
    source: "email",
    directoryId: null,
    userId: null,
    displayName: null,
    email: trimmed,
    jobTitle: null,
    department: null,
  };
  return [...people, typed];
};
