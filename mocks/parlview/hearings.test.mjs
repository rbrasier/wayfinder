import { describe, expect, it } from "vitest";
import { hearingById, hearingsAt } from "./hearings.mjs";

const PERIOD = 5 * 60 * 1000;
// The start of a slot, so "now" sits exactly on a transition.
const SLOT = 5_000_000;
const at = (slot, offset = 0) => slot * PERIOD + offset;

describe("hearingsAt", () => {
  it("has exactly one live hearing, with finished ones before it and scheduled ones after", () => {
    const hearings = hearingsAt(at(SLOT, 1_000), { periodMs: PERIOD });

    expect(hearings.filter((hearing) => hearing.status === "live")).toHaveLength(1);
    const statuses = hearings.map((hearing) => hearing.status);
    expect(statuses).toEqual(["finished", "finished", "finished", "finished", "finished", "live", "scheduled", "scheduled"]);
  });

  it("finishes the live hearing and starts the next one when the period rolls over", () => {
    const before = hearingsAt(at(SLOT, PERIOD - 1), { periodMs: PERIOD });
    const after = hearingsAt(at(SLOT + 1), { periodMs: PERIOD });

    const wasLive = before.find((hearing) => hearing.status === "live");
    const wasNext = before.find((hearing) => hearing.status === "scheduled");
    expect(after.find((hearing) => hearing.id === wasLive.id).status).toBe("finished");
    expect(after.find((hearing) => hearing.id === wasNext.id).status).toBe("live");
  });

  it("keeps a hearing's id and title stable across checks, so a watch can tell it apart", () => {
    const first = hearingsAt(at(SLOT, 10), { periodMs: PERIOD });
    const second = hearingsAt(at(SLOT, 20_000), { periodMs: PERIOD });

    expect(second.map(({ id, title }) => ({ id, title }))).toEqual(first.map(({ id, title }) => ({ id, title })));
  });

  it("stamps start and finish times only once they have happened", () => {
    const hearings = hearingsAt(at(SLOT, 1_000), { periodMs: PERIOD });
    const live = hearings.find((hearing) => hearing.status === "live");
    const finished = hearings.find((hearing) => hearing.status === "finished");
    const scheduled = hearings.find((hearing) => hearing.status === "scheduled");

    expect(live.startedAt).toBe(new Date(at(SLOT)).toISOString());
    expect(live.finishedAt).toBeNull();
    expect(finished.finishedAt).not.toBeNull();
    expect(scheduled.startedAt).toBeNull();
  });
});

describe("hearingById", () => {
  it("returns a hearing with its transcript once it has started", () => {
    const now = at(SLOT, 1_000);
    const live = hearingsAt(now, { periodMs: PERIOD }).find((hearing) => hearing.status === "live");

    const detail = hearingById(live.id, now, { periodMs: PERIOD });

    expect(detail.id).toBe(live.id);
    expect(detail.transcript).toContain(detail.committee);
  });

  it("returns null for an id that is not a mock hearing", () => {
    expect(hearingById("not-a-hearing", at(SLOT), { periodMs: PERIOD })).toBeNull();
  });
});
