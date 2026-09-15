import { describe, expect, it } from "vitest";
import { offSystemDateError } from "./off-system-approval";
import { offSystemApprovalAllowed } from "./approval-record";
import type { ApprovalNodeConfig } from "./flow-node";

const sessionStarted = new Date("2026-08-01T09:30:00.000Z");
const now = new Date("2026-08-20T14:00:00.000Z");

describe("offSystemDateError", () => {
  it("accepts a date between the start of the work and today", () => {
    expect(offSystemDateError("2026-08-14", sessionStarted, now)).toBeNull();
  });

  it("accepts today, whatever time of day it is now", () => {
    expect(offSystemDateError("2026-08-20", sessionStarted, now)).toBeNull();
  });

  it("accepts the day the work started, even though the session began mid-morning", () => {
    expect(offSystemDateError("2026-08-01", sessionStarted, now)).toBeNull();
  });

  it("rejects a date in the future", () => {
    expect(offSystemDateError("2026-08-21", sessionStarted, now)).toBe(
      "The approval date cannot be in the future.",
    );
  });

  it("rejects a date before the work being approved existed", () => {
    expect(offSystemDateError("2026-07-31", sessionStarted, now)).toBe(
      "The approval date cannot be before this work started.",
    );
  });

  it("rejects a date that is not written as YYYY-MM-DD", () => {
    expect(offSystemDateError("14/08/2026", sessionStarted, now)).toBe(
      "Enter the approval date as YYYY-MM-DD.",
    );
  });

  it("rejects a calendar date that does not exist rather than rolling it forward", () => {
    expect(offSystemDateError("2026-02-30", sessionStarted, now)).toBe(
      "Enter the approval date as YYYY-MM-DD.",
    );
  });

  it("rejects an empty date", () => {
    expect(offSystemDateError("", sessionStarted, now)).toBe(
      "Enter the approval date as YYYY-MM-DD.",
    );
  });
});

describe("offSystemApprovalAllowed", () => {
  const baseConfig: ApprovalNodeConfig = { approverSource: "first_level_supervisor" };

  it("allows an approval node authored before the setting existed", () => {
    expect(offSystemApprovalAllowed(baseConfig)).toBe(true);
  });

  it("allows it when the author left the box checked", () => {
    expect(offSystemApprovalAllowed({ ...baseConfig, allowOffSystemApproval: true })).toBe(true);
  });

  it("forbids it when the author unchecked the box", () => {
    expect(offSystemApprovalAllowed({ ...baseConfig, allowOffSystemApproval: false })).toBe(false);
  });
});
