import { describe, expect, it } from "vitest";
import type { LessonCandidate, LessonStatus } from "@wayfinder/domain";
import { lessonStatusPatch, proposedLessonValues } from "./drizzle-flow-lesson-repository";

const candidate: LessonCandidate = {
  nodeId: "node-1",
  kind: "guidance",
  statement: "Ask for the supplier's registered legal name.",
};

const span = {
  firstSeenAt: new Date("2026-01-01T00:00:00Z"),
  lastSeenAt: new Date("2026-02-01T00:00:00Z"),
};

describe("proposedLessonValues", () => {
  it("always writes status proposed", () => {
    expect(proposedLessonValues(candidate, "flow-1", ["obs-1"], span).status).toBe("proposed");
  });

  it("writes status proposed even for a candidate carrying extra fields", () => {
    // The port takes no status argument and this builder offers no way to smuggle
    // one in — that is the enforcement of ADR-057 §3, not a code review.
    const smuggled = { ...candidate, status: "accepted" } as LessonCandidate;

    expect(proposedLessonValues(smuggled, "flow-1", ["obs-1"], span).status).toBe("proposed");
  });

  it("sets evidenceCount to the number of linked observations", () => {
    const values = proposedLessonValues(candidate, "flow-1", ["obs-1", "obs-2", "obs-3"], span);

    expect(values.evidence_count).toBe(3);
  });

  it("takes the seen-at span from the evidence rather than from now", () => {
    const values = proposedLessonValues(candidate, "flow-1", ["obs-1"], span);

    expect(values.first_seen_at).toEqual(span.firstSeenAt);
    expect(values.last_seen_at).toEqual(span.lastSeenAt);
  });

  it("nulls supersedesLessonId when the candidate proposed no supersession", () => {
    expect(proposedLessonValues(candidate, "flow-1", ["obs-1"], span).supersedes_lesson_id).toBeNull();
  });

  it("carries a proposed supersession through", () => {
    const superseding: LessonCandidate = { ...candidate, supersedesLessonId: "lesson-old" };

    expect(
      proposedLessonValues(superseding, "flow-1", ["obs-1"], span).supersedes_lesson_id,
    ).toBe("lesson-old");
  });
});

describe("lessonStatusPatch", () => {
  const now = new Date("2026-03-01T00:00:00Z");

  it("stamps the decider and the time on an acceptance", () => {
    const patch = lessonStatusPatch("accepted", "user-1", now);

    expect(patch).toEqual({
      status: "accepted",
      updated_at: now,
      accepted_by_user_id: "user-1",
      accepted_at: now,
    });
  });

  it("leaves the acceptance fields untouched on every other transition", () => {
    // Stamping an acceptance on a rejection or a retirement would make the audit
    // trail claim someone accepted something they refused.
    const others: LessonStatus[] = ["proposed", "rejected", "retired"];

    for (const status of others) {
      const patch = lessonStatusPatch(status, "user-1", now);

      expect(patch).toEqual({ status, updated_at: now });
      expect(patch).not.toHaveProperty("accepted_at");
      expect(patch).not.toHaveProperty("accepted_by_user_id");
    }
  });

  it("records a null decider on a machine-driven retirement", () => {
    expect(lessonStatusPatch("retired", null, now)).toEqual({ status: "retired", updated_at: now });
  });
});
