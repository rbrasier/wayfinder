import { describe, expect, it } from "vitest";
import type { EventWatch } from "@rbrasier/domain";
import {
  canPickRow,
  conditionOfKind,
  describeCondition,
  emptyWatchForm,
  firstItemOf,
  formFromWatch,
  jsonTreeRows,
  pausedReasonLabel,
  secretChangeFor,
  watchInputFromForm,
} from "./watch-model";

describe("jsonTreeRows", () => {
  it("flattens a response into pickable rows with dotted and indexed paths", () => {
    const rows = jsonTreeRows({ data: { hearings: [{ id: "H-1", status: "live" }] } });

    expect(rows.map((row) => [row.path, row.kind, row.depth])).toEqual([
      ["data", "object", 0],
      ["data.hearings", "array", 1],
      ["data.hearings[0]", "object", 2],
      ["data.hearings[0].id", "value", 3],
      ["data.hearings[0].status", "value", 3],
    ]);
    expect(rows[3]!.preview).toBe('"H-1"');
    expect(rows[1]!.preview).toBe("1 item");
  });

  it("shows only the first few entries of a long list, saying how many more there are", () => {
    const rows = jsonTreeRows({ items: [1, 2, 3, 4, 5] });

    expect(rows.map((row) => row.path)).toEqual(["items", "items[0]", "items[1]", "items[2]", "items"]);
    expect(rows.at(-1)).toMatchObject({ kind: "more", preview: "2 more" });
  });

  it("lists a scalar response as one row with an empty path", () => {
    expect(jsonTreeRows("ok")).toEqual([{ path: "", label: "(response)", depth: 0, kind: "value", preview: '"ok"' }]);
  });
});

describe("firstItemOf", () => {
  it("is the first entry of the list at the items path, or the whole response with no path", () => {
    expect(firstItemOf({ data: [{ id: 1 }, { id: 2 }] }, "data")).toEqual({ id: 1 });
    expect(firstItemOf({ status: "live" }, "")).toEqual({ status: "live" });
    expect(firstItemOf({ data: "x" }, "data")).toBeUndefined();
  });
});

describe("describeCondition", () => {
  it("reads each kind as a sentence", () => {
    expect(describeCondition({ kind: "transition", fieldPath: "status", from: "live", to: "finished" })).toBe(
      "status changes from live to finished",
    );
    expect(describeCondition({ kind: "transition", fieldPath: "status", from: null, to: "finished" })).toBe(
      "status changes to finished",
    );
    expect(describeCondition({ kind: "matches", fieldPath: "title", operator: "contains", value: "Finance" })).toBe(
      "title contains Finance",
    );
    expect(describeCondition({ kind: "new_item" })).toBe("a new item appears");
    expect(describeCondition({ kind: "changed", fieldPath: "room" })).toBe("room changes");
  });
});

describe("pausedReasonLabel", () => {
  it("explains each reason in plain words", () => {
    expect(pausedReasonLabel("failure_threshold")).toBe("Paused after repeated failures");
    expect(pausedReasonLabel("manual")).toBe("Paused by an admin");
  });
});

describe("watch form", () => {
  it("round-trips a saved watch through the form", () => {
    const watch = {
      name: "Hearings",
      url: "https://api.example.gov.au",
      method: "POST",
      requestBody: { page: 1 },
      authType: "api_key",
      apiKeyPlacement: { in: "query", name: "key" },
      intervalMinutes: 5,
      itemsPath: "data",
      itemIdPath: "id",
      condition: { kind: "new_item" },
      fireOncePerItem: false,
      maxRunsPerPoll: 10,
      failureThreshold: 3,
      flowId: "flow-1",
      inputMapping: { hearing_id: "id" },
      runAsUserId: "user-1",
    } as unknown as EventWatch;

    const form = formFromWatch(watch);
    const input = watchInputFromForm(form);

    expect(form.requestBody).toBe('{\n  "page": 1\n}');
    expect(input.data).toEqual(watch);
  });

  it("refuses a request body that is not JSON", () => {
    const form = { ...emptyWatchForm(), method: "POST" as const, requestBody: "{ nope" };

    expect(watchInputFromForm(form).error).toBe("The request body is not valid JSON.");
  });

  it("starts a new watch with the safe defaults", () => {
    expect(emptyWatchForm()).toMatchObject({
      intervalMinutes: 5,
      fireOncePerItem: true,
      maxRunsPerPoll: 20,
      failureThreshold: 5,
      condition: { kind: "transition", fieldPath: "", from: null, to: "" },
    });
  });
});

describe("conditionOfKind", () => {
  const transition = { kind: "transition", fieldPath: "status", from: "live", to: "finished" } as const;

  it("keeps the chosen field when switching between kinds that use one", () => {
    expect(conditionOfKind("matches", transition)).toEqual({
      kind: "matches",
      fieldPath: "status",
      operator: "equals",
      value: "",
    });
    expect(conditionOfKind("changed", transition)).toEqual({ kind: "changed", fieldPath: "status" });
  });

  it("drops the field for new_item and starts empty coming back from it", () => {
    expect(conditionOfKind("new_item", transition)).toEqual({ kind: "new_item" });
    expect(conditionOfKind("transition", { kind: "new_item" })).toEqual({
      kind: "transition",
      fieldPath: "",
      from: null,
      to: "",
    });
  });
});

describe("canPickRow", () => {
  const row = (kind: "object" | "array" | "value") => ({ path: "x", label: "x", depth: 0, kind, preview: "" });

  it("takes only a list for the items path and only a value for the ID or condition field", () => {
    expect(canPickRow({ kind: "items" }, row("array"))).toBe(true);
    expect(canPickRow({ kind: "items" }, row("value"))).toBe(false);
    expect(canPickRow({ kind: "item_id" }, row("value"))).toBe(true);
    expect(canPickRow({ kind: "condition" }, row("object"))).toBe(false);
  });

  it("lets an input take any part of the item", () => {
    expect(canPickRow({ kind: "input", key: "hearing" }, row("object"))).toBe(true);
  });
});

describe("secretChangeFor", () => {
  it("replaces with a typed secret, clears on request, and otherwise keeps the stored one", () => {
    expect(secretChangeFor("new-token", false)).toBe("new-token");
    expect(secretChangeFor("ignored", true)).toBeNull();
    expect(secretChangeFor("  ", false)).toBeUndefined();
  });
});
