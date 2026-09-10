import { describe, expect, it } from "vitest";
import type { RetentionPolicy } from "@wayfinder/domain";
import {
  KEEP_FOREVER_LABEL,
  LEGAL_HOLD_NOTE,
  parseWindowInput,
  retentionRows,
  windowLabel,
} from "./retention-card-model";

const policy = (key: string, retentionDays: number): RetentionPolicy =>
  ({ key, label: key, retentionDays }) as RetentionPolicy;

describe("windowLabel", () => {
  it("reads zero as keep forever, never as a bare number of days", () => {
    // Zero disables the sweep; showing "0 days" in a box labelled days invites
    // exactly the wrong conclusion.
    expect(windowLabel(0)).toBe(KEEP_FOREVER_LABEL);
  });

  it("reads a negative window as keep forever too", () => {
    expect(windowLabel(-5)).toBe(KEEP_FOREVER_LABEL);
  });

  it("counts days, singular and plural", () => {
    expect(windowLabel(1)).toBe("1 day");
    expect(windowLabel(90)).toBe("90 days");
  });
});

describe("retentionRows", () => {
  it("renders one row per policy", () => {
    const rows = retentionRows([policy("app_error_log", 0), policy("ai_flow_observations", 90)]);

    expect(rows.map((row) => row.key)).toEqual(["app_error_log", "ai_flow_observations"]);
  });

  it("marks which targets are actually sweeping", () => {
    const rows = retentionRows([policy("app_error_log", 0), policy("core_audit_log", 30)]);

    expect(rows[0]!.isSweeping).toBe(false);
    expect(rows[1]!.isSweeping).toBe(true);
  });

  it("warns that flow observations outlive the chats they came from", () => {
    const rows = retentionRows([policy("ai_flow_observations", 0)]);

    expect(rows[0]!.note).toContain("not deleted when a chat is");
  });

  it("adds no note to the other targets", () => {
    expect(retentionRows([policy("app_error_log", 0)])[0]!.note).toBeNull();
  });

  it("states that a legal hold overrides every window", () => {
    expect(LEGAL_HOLD_NOTE).toContain("legal hold");
  });
});

describe("parseWindowInput", () => {
  it("reads an empty box as keep forever rather than as an error", () => {
    // An admin clearing the field mid-edit is not asking to delete everything.
    expect(parseWindowInput("")).toBe(0);
    expect(parseWindowInput("   ")).toBe(0);
  });

  it("accepts a whole number of days", () => {
    expect(parseWindowInput("90")).toBe(90);
    expect(parseWindowInput("0")).toBe(0);
  });

  it("rejects anything that is not a whole non-negative number", () => {
    expect(parseWindowInput("-1")).toBeNull();
    expect(parseWindowInput("1.5")).toBeNull();
    expect(parseWindowInput("soon")).toBeNull();
  });
});
