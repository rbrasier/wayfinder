import { describe, expect, it } from "vitest";
import {
  INJECTED_LESSON_CAP,
  isInjectable,
  lessonsToRetire,
  selectInjectableLessons,
  type FlowLesson,
  type LessonKind,
  type LessonStatus,
} from "./flow-lesson";

const lesson = (overrides: Partial<FlowLesson> = {}): FlowLesson => ({
  id: "lesson-1",
  flowId: "flow-1",
  nodeId: "node-1",
  kind: "guidance",
  statement: "Ask for the supplier's registered legal name, not its trading name.",
  status: "accepted",
  evidenceCount: 3,
  firstSeenAt: new Date("2026-01-01T00:00:00Z"),
  lastSeenAt: new Date("2026-02-01T00:00:00Z"),
  acceptedByUserId: "user-1",
  acceptedAt: new Date("2026-02-02T00:00:00Z"),
  supersedesLessonId: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-02-02T00:00:00Z"),
  ...overrides,
});

describe("isInjectable", () => {
  it("accepts an accepted guidance lesson", () => {
    expect(isInjectable(lesson({ kind: "guidance", status: "accepted" }))).toBe(true);
  });

  it("accepts an accepted efficiency lesson", () => {
    expect(isInjectable(lesson({ kind: "efficiency", status: "accepted" }))).toBe(true);
  });

  it("excludes a knowledge_gap lesson even when accepted", () => {
    // ADR-057 §6: a knowledge gap is fixed by curating the knowledge base, never
    // by telling the model to be more careful.
    expect(isInjectable(lesson({ kind: "knowledge_gap", status: "accepted" }))).toBe(false);
  });

  it("excludes every status other than accepted", () => {
    const inertStatuses: LessonStatus[] = ["proposed", "rejected", "retired"];
    for (const status of inertStatuses) {
      expect(isInjectable(lesson({ status }))).toBe(false);
    }
  });

  it("excludes a lesson with a blank statement", () => {
    expect(isInjectable(lesson({ statement: "   " }))).toBe(false);
  });
});

describe("selectInjectableLessons", () => {
  it("returns nothing for an empty list", () => {
    expect(selectInjectableLessons([], 5)).toEqual([]);
  });

  it("drops every non-injectable lesson", () => {
    const kinds: LessonKind[] = ["guidance", "efficiency", "knowledge_gap"];
    const lessons = kinds.map((kind, index) =>
      lesson({ id: `lesson-${index}`, kind, statement: `statement ${index}` }),
    );

    const selected = selectInjectableLessons(lessons, 5);

    expect(selected.map((entry) => entry.statement)).toEqual(["statement 0", "statement 1"]);
  });

  it("orders most recently accepted first", () => {
    const older = lesson({
      id: "older",
      statement: "older",
      acceptedAt: new Date("2026-01-01T00:00:00Z"),
    });
    const newer = lesson({
      id: "newer",
      statement: "newer",
      acceptedAt: new Date("2026-03-01T00:00:00Z"),
    });

    const selected = selectInjectableLessons([older, newer], 5);

    expect(selected.map((entry) => entry.statement)).toEqual(["newer", "older"]);
  });

  it("caps the list, keeping the most recently accepted", () => {
    const lessons = [1, 2, 3, 4, 5, 6].map((index) =>
      lesson({
        id: `lesson-${index}`,
        statement: `statement ${index}`,
        acceptedAt: new Date(`2026-0${index}-01T00:00:00Z`),
      }),
    );

    const selected = selectInjectableLessons(lessons, 5);

    expect(selected).toHaveLength(5);
    expect(selected.map((entry) => entry.statement)).toEqual([
      "statement 6",
      "statement 5",
      "statement 4",
      "statement 3",
      "statement 2",
    ]);
  });

  it("projects to statement only, so nothing else can reach the model", () => {
    const selected = selectInjectableLessons([lesson()], 5);

    expect(Object.keys(selected[0]!)).toEqual(["statement"]);
  });

  it("sorts a lesson with no acceptedAt last rather than dropping it", () => {
    const undated = lesson({ id: "undated", statement: "undated", acceptedAt: null });
    const dated = lesson({ id: "dated", statement: "dated" });

    const selected = selectInjectableLessons([undated, dated], 5);

    expect(selected.map((entry) => entry.statement)).toEqual(["dated", "undated"]);
  });

  it("defaults the cap to INJECTED_LESSON_CAP", () => {
    const lessons = Array.from({ length: INJECTED_LESSON_CAP + 3 }, (_unused, index) =>
      lesson({ id: `lesson-${index}`, statement: `statement ${index}` }),
    );

    expect(selectInjectableLessons(lessons)).toHaveLength(INJECTED_LESSON_CAP);
  });
});

describe("lessonsToRetire", () => {
  it("returns exactly the lessons whose node is absent from the live flow", () => {
    const onLiveNode = lesson({ id: "keep", nodeId: "node-1" });
    const onDeletedNode = lesson({ id: "retire", nodeId: "node-gone" });

    const retiring = lessonsToRetire([onLiveNode, onDeletedNode], ["node-1", "node-2"]);

    expect(retiring.map((entry) => entry.id)).toEqual(["retire"]);
  });

  it("leaves an already-retired lesson alone, so it is not retired twice", () => {
    const alreadyRetired = lesson({ id: "already", nodeId: "node-gone", status: "retired" });

    expect(lessonsToRetire([alreadyRetired], ["node-1"])).toEqual([]);
  });

  it("retires a proposed lesson on a deleted node, not only an accepted one", () => {
    const proposed = lesson({ id: "proposed", nodeId: "node-gone", status: "proposed" });

    expect(lessonsToRetire([proposed], ["node-1"]).map((entry) => entry.id)).toEqual(["proposed"]);
  });

  it("retires nothing when the flow has every node the lessons name", () => {
    expect(lessonsToRetire([lesson()], ["node-1"])).toEqual([]);
  });

  it("retires everything when the flow reports no live nodes", () => {
    // An empty node list means the caller could not resolve the graph; retiring
    // on that basis would silently withdraw every lesson on the flow.
    expect(lessonsToRetire([lesson()], [])).toEqual([]);
  });
});
