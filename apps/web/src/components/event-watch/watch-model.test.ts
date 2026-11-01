import { describe, expect, it } from "vitest";
import type { EventWatch } from "@wayfinder/domain";
import {
  conditionOfKind,
  describeCondition,
  emptyWatchForm,
  firstItemOf,
  formFromWatch,
  isManualFieldValue,
  jsonTreeRows,
  pausedReasonLabel,
  runNowMessage,
  sampleFieldOptions,
  secretChangeFor,
  watchInputFromForm,
  watchProblems,
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

describe("sampleFieldOptions", () => {
  const sample = { data: { hearings: [{ id: "H-1", committee: { name: "Finance" }, tags: ["a"] }, { id: "H-2" }] } };

  it("lists the response's lists for the items path, with the whole response first", () => {
    expect(sampleFieldOptions(sample, "", "items").map((option) => option.path)).toEqual([
      "",
      "data.hearings",
      "data.hearings[0].tags",
    ]);
  });

  it("lists the first item's values for an ID or condition field, labelled with a sample value", () => {
    expect(sampleFieldOptions(sample, "data.hearings", "item_value")).toEqual([
      { path: "id", label: 'id — "H-1"' },
      { path: "committee.name", label: 'committee.name — "Finance"' },
      { path: "tags[0]", label: 'tags[0] — "a"' },
    ]);
  });

  it("lists any part of the item for an input", () => {
    expect(sampleFieldOptions(sample, "data.hearings", "item_any").map((option) => option.path)).toContain(
      "committee",
    );
  });

  it("lists nothing before a sample is fetched or when the items path leads nowhere", () => {
    expect(sampleFieldOptions(undefined, "", "item_value")).toEqual([]);
    expect(sampleFieldOptions(sample, "missing", "item_value")).toEqual([]);
  });
});

describe("isManualFieldValue", () => {
  const options = [{ path: "id", label: "id" }];

  it("switches to typing when chosen, or when the saved path is not in the sample", () => {
    expect(isManualFieldValue("id", options, false)).toBe(false);
    expect(isManualFieldValue("", options, false)).toBe(false);
    expect(isManualFieldValue("hearing.ref", options, false)).toBe(true);
    expect(isManualFieldValue("id", options, true)).toBe(true);
  });
});

describe("secretChangeFor", () => {
  it("replaces with a typed secret, clears on request, and otherwise keeps the stored one", () => {
    expect(secretChangeFor("new-token", false)).toBe("new-token");
    expect(secretChangeFor("ignored", true)).toBeNull();
    expect(secretChangeFor("  ", false)).toBeUndefined();
  });
});

describe("watchProblems", () => {
  const hearing = { key: "hearing_id", label: "Hearing", type: "text" as const, required: true };
  const complete = {
    ...emptyWatchForm(),
    name: "Hearings",
    url: "https://api.example.com/hearings",
    itemsPath: "data.hearings",
    itemIdPath: "id",
    condition: { kind: "transition" as const, fieldPath: "status", from: null, to: "finished" },
    flowId: "6f1c2b8e-0d6a-4f39-9a8e-1f2d3c4b5a69",
    runAsUserId: "0b7f0e8a-5d0c-4c47-8d61-2a8e4f9c1b23",
    inputMapping: { hearing_id: "id" },
  };

  it("finds nothing wrong with a complete watch", () => {
    expect(watchProblems(complete, { hasSecret: false, triggerInputs: [hearing] })).toEqual([]);
  });

  it("names a missing flow and run owner instead of leaving them for the server to refuse", () => {
    const problems = watchProblems({ ...complete, flowId: "", runAsUserId: "" }, { hasSecret: false, triggerInputs: [] });

    expect(problems).toEqual([
      { field: "flow", message: "Choose the flow to start." },
      { field: "runAs", message: "Choose who the runs belong to." },
    ]);
  });

  it("names each required flow input no item field supplies", () => {
    expect(watchProblems({ ...complete, inputMapping: {} }, { hasSecret: false, triggerInputs: [hearing] })).toEqual([
      { field: "inputs", inputKey: "hearing_id", message: "Choose the field that supplies Hearing." },
    ]);
  });

  it("puts a request body that is not JSON with the connection", () => {
    const problems = watchProblems(
      { ...complete, method: "POST" as const, requestBody: "{ nope" },
      { hasSecret: false, triggerInputs: [hearing] },
    );

    expect(problems).toEqual([{ field: "connection", message: "The request body is not valid JSON." }]);
  });
});

describe("runNowMessage", () => {
  const checked = { outcome: "checked" as const, started: 0, failed: false, paused: false, lastError: null };

  it("says how many runs a check started", () => {
    expect(runNowMessage({ ...checked, started: 1 })).toEqual({ tone: "success", text: "Checked: started 1 run." });
    expect(runNowMessage({ ...checked, started: 3 })).toEqual({ tone: "success", text: "Checked: started 3 runs." });
  });

  it("says when nothing met the condition", () => {
    expect(runNowMessage(checked)).toEqual({
      tone: "info",
      text: "Checked: no item meets the condition right now, so nothing started.",
    });
  });

  it("gives the reason a check failed or paused the watch", () => {
    expect(runNowMessage({ ...checked, failed: true, lastError: "The API answered 503." })).toEqual({
      tone: "error",
      text: "The check failed: The API answered 503.",
    });
    expect(runNowMessage({ ...checked, paused: true, lastError: "Too many matched." })).toEqual({
      tone: "error",
      text: "The check paused the watch: Too many matched.",
    });
  });

  it("asks to try again when a check is already under way", () => {
    expect(runNowMessage({ outcome: "busy" })).toEqual({
      tone: "info",
      text: "A check of this watch started moments ago. Try again in a few seconds.",
    });
  });
});
