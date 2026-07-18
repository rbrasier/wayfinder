import { describe, it, expect } from "vitest";
import { buildGroupTable, humaniseKey } from "./group-table";

describe("humaniseKey", () => {
  it("title-cases a snake_case key", () => {
    expect(humaniseKey("contract_value")).toBe("Contract Value");
    expect(humaniseKey("owner")).toBe("Owner");
  });

  it("leaves a single word capitalised", () => {
    expect(humaniseKey("status")).toBe("Status");
  });
});

describe("buildGroupTable", () => {
  it("derives columns from the union of item keys in first-seen order", () => {
    const table = buildGroupTable([
      { owner: "Finance", action: "Review" },
      { owner: "Ops", action: "Approve", deadline: "30-06-2026" },
    ]);

    expect(table.columns).toEqual([
      { key: "owner", label: "Owner" },
      { key: "action", label: "Action" },
      { key: "deadline", label: "Deadline" },
    ]);
  });

  it("emits a cell per column per row, blank where a key is absent", () => {
    const table = buildGroupTable([
      { owner: "Finance", action: "Review" },
      { owner: "Ops", action: "Approve", deadline: "30-06-2026" },
    ]);

    expect(table.rows).toEqual([
      ["Finance", "Review", ""],
      ["Ops", "Approve", "30-06-2026"],
    ]);
  });

  it("returns no columns or rows for an empty list", () => {
    expect(buildGroupTable([])).toEqual({ columns: [], rows: [] });
  });
});
