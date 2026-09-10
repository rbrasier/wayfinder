import { describe, expect, it } from "vitest";
import { buildApproverEditMessage } from "@wayfinder/domain";
import { parseApproverEditMessage } from "./approver-edit-message";

describe("parseApproverEditMessage", () => {
  it("round-trips what the domain writes", () => {
    const content = buildApproverEditMessage({
      editorName: "Ada Lovelace",
      changedLabels: ["Start date", "Employee name"],
    })!;

    expect(parseApproverEditMessage(content)).toEqual({
      editorName: "Ada Lovelace",
      changedLabels: ["Start date", "Employee name"],
    });
  });

  it("round-trips the deleted-account fallback", () => {
    const content = buildApproverEditMessage({
      editorName: null,
      changedLabels: ["Start date"],
    })!;

    expect(parseApproverEditMessage(content)?.editorName).toBe("The approver");
  });

  it("returns null for anything that is not an announcement", () => {
    // An operator who happens to type a similar sentence is never dressed up as
    // an approver, and no document card is attached to their message.
    expect(parseApproverEditMessage("I edited the start date before sending it.")).toBeNull();
    expect(parseApproverEditMessage("Cross-check complete — everything is in alignment.")).toBeNull();
    expect(parseApproverEditMessage("")).toBeNull();
  });

  it("ignores a message with the phrase but no fields", () => {
    expect(
      parseApproverEditMessage("Ada edited this step before deciding the approval:"),
    ).toBeNull();
  });
});
