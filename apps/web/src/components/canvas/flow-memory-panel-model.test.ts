import { describe, expect, it, vi } from "vitest";
import type { FlowLesson } from "@wayfinder/domain";
import {
  EMPTY_STATE_MESSAGE,
  evidenceLabel,
  isPanelState,
  panelStateStorageKey,
  proposedCount,
  readPanelState,
  stateAfterCollapsing,
  stateAfterDismissingDrawer,
  stateAfterOpeningLesson,
  stateAfterReopening,
  statTiles,
  visibleLessons,
  writePanelState,
  type PanelStateStore,
} from "./flow-memory-panel-model";

const lesson = (overrides: Partial<FlowLesson> = {}): FlowLesson =>
  ({
    id: "lesson-1",
    flowId: "flow-1",
    nodeId: "node-1",
    kind: "guidance",
    statement: "Ask for the registered legal name.",
    status: "proposed",
    evidenceCount: 3,
    ...overrides,
  }) as FlowLesson;

const memoryStore = (initial: Record<string, string> = {}): PanelStateStore & {
  values: Record<string, string>;
} => {
  const values = { ...initial };
  return {
    values,
    getItem: (key) => values[key] ?? null,
    setItem: (key, value) => {
      values[key] = value;
    },
  };
};

describe("panel state persistence", () => {
  it("keys storage per flow, so two flows remember separately", () => {
    expect(panelStateStorageKey("flow-1")).not.toBe(panelStateStorageKey("flow-2"));
  });

  it("defaults to narrow when nothing has been stored", () => {
    expect(readPanelState(memoryStore(), "flow-1")).toBe("narrow");
  });

  it("reads back exactly what was written", () => {
    // This is the persistence contract the panel actually owns. Whether a browser
    // keeps localStorage across a reload is the browser's job, not this feature's.
    const store = memoryStore();

    writePanelState(store, "flow-1", "hidden");

    expect(readPanelState(store, "flow-1")).toBe("hidden");
  });

  it("writes under the flow's own key", () => {
    const store = memoryStore();

    writePanelState(store, "flow-1", "expanded");

    expect(store.values[panelStateStorageKey("flow-1")]).toBe("expanded");
  });

  it("ignores a stored value that is not a panel state", () => {
    const store = memoryStore({ [panelStateStorageKey("flow-1")]: "gigantic" });

    expect(readPanelState(store, "flow-1")).toBe("narrow");
  });

  it("falls back to narrow when there is no store at all", () => {
    expect(readPanelState(null, "flow-1")).toBe("narrow");
  });

  it("survives a store that throws on read", () => {
    // A private window or blocked site data throws on access. A remembered panel
    // width is never worth a crash on mount.
    const throwing: PanelStateStore = {
      getItem: vi.fn(() => {
        throw new Error("Access denied.");
      }),
      setItem: vi.fn(),
    };

    expect(readPanelState(throwing, "flow-1")).toBe("narrow");
  });

  it("survives a store that throws on write", () => {
    const throwing: PanelStateStore = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new Error("Quota exceeded.");
      }),
    };

    expect(() => writePanelState(throwing, "flow-1", "hidden")).not.toThrow();
  });

  it("accepts only the three real states", () => {
    expect(isPanelState("hidden")).toBe(true);
    expect(isPanelState("narrow")).toBe(true);
    expect(isPanelState("expanded")).toBe(true);
    expect(isPanelState("collapsed")).toBe(false);
    expect(isPanelState(null)).toBe(false);
  });
});

describe("panel state transitions", () => {
  it("expands when a lesson is opened", () => {
    expect(stateAfterOpeningLesson()).toBe("expanded");
  });

  it("returns to narrow when the drawer is dismissed, not to hidden", () => {
    // Dismissing the drawer gives the canvas back; it does not make the panel
    // vanish under the author.
    expect(stateAfterDismissingDrawer()).toBe("narrow");
  });

  it("hides on collapse and returns narrow on reopen", () => {
    expect(stateAfterCollapsing()).toBe("hidden");
    expect(stateAfterReopening()).toBe("narrow");
  });
});

describe("lesson list", () => {
  it("lists proposed and accepted lessons", () => {
    const lessons = [lesson({ id: "p", status: "proposed" }), lesson({ id: "a", status: "accepted" })];

    expect(visibleLessons(lessons).map((entry) => entry.id)).toEqual(["p", "a"]);
  });

  it("lists neither rejected nor retired lessons", () => {
    // Showing an author a decision they already made, or one the system made for
    // them, is noise.
    const lessons = [
      lesson({ id: "r", status: "rejected" }),
      lesson({ id: "t", status: "retired" }),
    ];

    expect(visibleLessons(lessons)).toEqual([]);
  });

  it("counts only the lessons awaiting a decision", () => {
    const lessons = [
      lesson({ status: "proposed" }),
      lesson({ status: "proposed" }),
      lesson({ status: "accepted" }),
    ];

    expect(proposedCount(lessons)).toBe(2);
  });

  it("names the evidence count in plain words", () => {
    expect(evidenceLabel(1)).toBe("1 session");
    expect(evidenceLabel(4)).toBe("4 sessions");
  });

  it("explains in the empty state why a duplicated flow remembers nothing", () => {
    expect(EMPTY_STATE_MESSAGE).toContain("duplicated");
  });
});

describe("statTiles", () => {
  it("renders the five tiles in the documented order", () => {
    const tiles = statTiles({ total: 9, completed: 4, inProgress: 3, stale: 1, abandoned: 2 });

    expect(tiles.map((tile) => tile.key)).toEqual([
      "total",
      "completed",
      "inProgress",
      "stale",
      "abandoned",
    ]);
    expect(tiles.map((tile) => tile.value)).toEqual([9, 4, 3, 1, 2]);
  });
});
