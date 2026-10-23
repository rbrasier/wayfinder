import { describe, expect, it } from "vitest";
import { recipientSuggestions } from "./recipient-suggestions";

const people = [
  { userId: "user-1", email: "sam.lee@agency.gov.au", displayName: "Sam Lee" },
  { userId: null, email: "media@agency.gov.au", displayName: "Media unit" },
];
const groups = [
  { id: "group-1", name: "Estimates team" },
  { id: "group-2", name: "Finance" },
];

describe("recipientSuggestions", () => {
  it("suggests matching people and groups, people with an account as users", () => {
    expect(recipientSuggestions("est", people, groups)).toEqual([
      { label: "Estimates team", detail: "Group", recipient: { kind: "group", groupId: "group-1" } },
    ]);
    expect(recipientSuggestions("sam", people, [])[0]).toEqual({
      label: "Sam Lee",
      detail: "sam.lee@agency.gov.au",
      recipient: { kind: "user", userId: "user-1" },
    });
  });

  it("suggests a directory entry without an account as a plain address", () => {
    expect(recipientSuggestions("media", people, [])[0]!.recipient).toEqual({
      kind: "address",
      email: "media@agency.gov.au",
    });
  });

  it("offers any typed address that is not already suggested, first", () => {
    expect(recipientSuggestions("press@other.org", [], groups)).toEqual([
      { label: "Add press@other.org", detail: "Email address", recipient: { kind: "address", email: "press@other.org" } },
    ]);
    expect(
      recipientSuggestions("media@agency.gov.au", people, []).filter((option) => option.label.startsWith("Add ")),
    ).toEqual([]);
  });

  it("suggests nothing for under two characters", () => {
    expect(recipientSuggestions("s", people, groups)).toEqual([]);
  });
});
