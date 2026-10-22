import { describe, expect, it } from "vitest";
import {
  evaluateWatchItems,
  readJsonPath,
  validateEventWatch,
  watchItemsOf,
  type EventWatchDraft,
  type WatchCondition,
  type WatchItemState,
} from "./event-watch";

describe("readJsonPath", () => {
  const response = { data: { hearings: [{ id: "H-1", status: "live", room: { name: "2S1" } }] } };

  it("walks dotted keys and [n] indices", () => {
    expect(readJsonPath(response, "data.hearings[0].room.name")).toBe("2S1");
  });

  it("returns the value itself for an empty path", () => {
    expect(readJsonPath(response, "")).toBe(response);
  });

  it("returns undefined for a missing key, a bad index or a path through a scalar", () => {
    expect(readJsonPath(response, "data.missing")).toBeUndefined();
    expect(readJsonPath(response, "data.hearings[5].id")).toBeUndefined();
    expect(readJsonPath(response, "data.hearings[0].status.length")).toBeUndefined();
  });
});

const state = (itemId: string, value: unknown, firedAt: Date | null = null): WatchItemState => ({
  watchId: "watch-1",
  itemId,
  lastValues: { status: value },
  firedAt,
  lastSeenAt: new Date(0),
});

const evaluate = (
  condition: WatchCondition,
  items: unknown[],
  previous: WatchItemState[] = [],
  options: { baseline?: boolean; fireOncePerItem?: boolean } = {},
) =>
  evaluateWatchItems({
    condition,
    items,
    itemIdPath: "id",
    previousStates: previous,
    baseline: options.baseline ?? false,
    fireOncePerItem: options.fireOncePerItem ?? true,
  });

const firedIds = (result: ReturnType<typeof evaluate>) => result.toFire.map((fired) => fired.itemId);

describe("evaluateWatchItems", () => {
  const finished: WatchCondition = { kind: "transition", fieldPath: "status", from: "live", to: "finished" };

  it("fires a transition only when the value moves from the stated value to the target", () => {
    const result = evaluate(
      finished,
      [
        { id: "H-1", status: "finished" },
        { id: "H-2", status: "finished" },
        { id: "H-3", status: "live" },
      ],
      [state("H-1", "live"), state("H-2", "scheduled"), state("H-3", "scheduled")],
    );

    expect(firedIds(result)).toEqual(["H-1"]);
  });

  it("treats a transition with no from as from any other value", () => {
    const anyToFinished: WatchCondition = { kind: "transition", fieldPath: "status", from: null, to: "finished" };

    const result = evaluate(anyToFinished, [{ id: "H-2", status: "finished" }], [state("H-2", "scheduled")]);

    expect(firedIds(result)).toEqual(["H-2"]);
  });

  it("never fires a transition for an item seen for the first time", () => {
    expect(firedIds(evaluate(finished, [{ id: "H-9", status: "finished" }]))).toEqual([]);
  });

  it("fires matches only on the edge into the match, not on every poll while it matches", () => {
    const matching: WatchCondition = { kind: "matches", fieldPath: "status", operator: "equals", value: "finished" };

    const entering = evaluate(matching, [{ id: "H-1", status: "finished" }], [state("H-1", "live")]);
    const staying = evaluate(matching, [{ id: "H-1", status: "finished" }], [state("H-1", "finished")], {
      fireOncePerItem: false,
    });

    expect(firedIds(entering)).toEqual(["H-1"]);
    expect(firedIds(staying)).toEqual([]);
  });

  it("supports not_equals, case-insensitive contains, and regex operators", () => {
    const items = [{ id: "A", status: "Finance Committee" }];
    const op = (operator: "not_equals" | "contains" | "regex", value: string): WatchCondition => ({
      kind: "matches",
      fieldPath: "status",
      operator,
      value,
    });

    expect(firedIds(evaluate(op("not_equals", "Other"), items))).toEqual(["A"]);
    expect(firedIds(evaluate(op("contains", "finance"), items))).toEqual(["A"]);
    expect(firedIds(evaluate(op("regex", "^Fin.*tee$"), items))).toEqual(["A"]);
    expect(firedIds(evaluate(op("regex", "("), items))).toEqual([]);
  });

  it("fires new_item for ids with no previous state", () => {
    const result = evaluate({ kind: "new_item" }, [{ id: "H-1" }, { id: "H-2" }], [state("H-1", undefined)]);

    expect(firedIds(result)).toEqual(["H-2"]);
  });

  it("fires changed only when a seen value differs", () => {
    const changed: WatchCondition = { kind: "changed", fieldPath: "status" };

    const result = evaluate(
      changed,
      [
        { id: "H-1", status: "finished" },
        { id: "H-2", status: "live" },
        { id: "H-3", status: "live" },
      ],
      [state("H-1", "live"), state("H-2", "live")],
    );

    expect(firedIds(result)).toEqual(["H-1"]);
  });

  it("compares strictly, so the number 1 and the string 1 differ", () => {
    const changed: WatchCondition = { kind: "changed", fieldPath: "status" };

    expect(firedIds(evaluate(changed, [{ id: "A", status: 1 }], [state("A", "1")]))).toEqual(["A"]);
  });

  it("records state and fires nothing on a baseline poll", () => {
    const result = evaluate(finished, [{ id: "H-1", status: "live" }], [], { baseline: true });

    expect(result.toFire).toEqual([]);
    expect(result.nextStates).toEqual([{ itemId: "H-1", lastValues: { status: "live" } }]);
  });

  it("never fires an item twice when fire-once is on", () => {
    const result = evaluate(finished, [{ id: "H-1", status: "finished" }], [state("H-1", "live", new Date(0))]);

    expect(result.toFire).toEqual([]);
  });

  it("lets an item fire again when fire-once is off", () => {
    const result = evaluate(finished, [{ id: "H-1", status: "finished" }], [state("H-1", "live", new Date(0))], {
      fireOncePerItem: false,
    });

    expect(firedIds(result)).toEqual(["H-1"]);
  });

  it("skips items with no id rather than guessing one", () => {
    const result = evaluate({ kind: "new_item" }, [{ status: "live" }, { id: "" }, { id: 7 }]);

    expect(firedIds(result)).toEqual(["7"]);
    expect(result.skippedWithoutId).toBe(2);
  });

  it("hands back each item that fired so its inputs can be mapped", () => {
    const result = evaluate({ kind: "new_item" }, [{ id: "H-1", title: "Finance" }]);

    expect(result.toFire).toEqual([{ itemId: "H-1", item: { id: "H-1", title: "Finance" } }]);
  });
});

const draft = (overrides: Partial<EventWatchDraft> = {}): EventWatchDraft => ({
  name: "Estimates hearings",
  url: "https://api.example.gov.au/hearings",
  method: "GET",
  authType: "bearer",
  apiKeyPlacement: null,
  hasSecret: true,
  intervalMinutes: 2,
  itemsPath: "data.hearings",
  itemIdPath: "id",
  condition: { kind: "transition", fieldPath: "status", from: "live", to: "finished" },
  maxRunsPerPoll: 20,
  failureThreshold: 5,
  flowId: "flow-1",
  runAsUserId: "user-1",
  ...overrides,
});

describe("validateEventWatch", () => {
  it("accepts a complete watch", () => {
    expect(validateEventWatch(draft())).toEqual([]);
  });

  it("names every problem with a broken watch", () => {
    const problems = validateEventWatch(
      draft({
        name: " ",
        url: "ftp://example.com",
        intervalMinutes: 0,
        itemIdPath: "",
        condition: { kind: "transition", fieldPath: "", from: null, to: "" },
        failureThreshold: 0,
        maxRunsPerPoll: 0,
        hasSecret: false,
        flowId: "",
      }),
    );

    expect(problems).toEqual([
      "Give the watch a name.",
      "Enter an http:// or https:// address.",
      "Check at least every 1 minute and at most every 1,440.",
      "Choose the field that identifies each item.",
      "Choose the field the condition watches.",
      "Enter the value the field changes to.",
      "Pause after between 1 and 50 failures in a row.",
      "Allow between 1 and 100 runs per check.",
      "Enter the token or key for this connection.",
      "Choose the flow to start.",
    ]);
  });

  it("requires an API key's header or parameter name", () => {
    expect(validateEventWatch(draft({ authType: "api_key", apiKeyPlacement: { in: "header", name: "" } }))).toEqual([
      "Name the header or query parameter that carries the key.",
    ]);
  });

  it("rejects an invalid pattern", () => {
    expect(
      validateEventWatch(draft({ condition: { kind: "matches", fieldPath: "status", operator: "regex", value: "(" } })),
    ).toEqual(["The pattern is not a valid regular expression."]);
  });

  it("needs no identifying field when the response is a single object", () => {
    expect(validateEventWatch(draft({ itemsPath: "", itemIdPath: "" }))).toEqual([]);
  });
});

describe("watchItemsOf", () => {
  it("reads the list at the items path", () => {
    expect(watchItemsOf({ data: { hearings: [{ id: 1 }] } }, "data.hearings").data).toEqual([{ id: 1 }]);
  });

  it("treats the whole response as one item when there is no items path", () => {
    expect(watchItemsOf({ status: "live" }, "").data).toEqual([{ status: "live" }]);
  });

  it("fails when the items path does not lead to a list", () => {
    expect(watchItemsOf({ data: {} }, "data.hearings").error?.message).toBe(
      "The response has no list at data.hearings.",
    );
  });
});
