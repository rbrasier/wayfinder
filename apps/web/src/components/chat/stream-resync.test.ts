import { describe, expect, it } from "vitest";
import { shouldResyncStreamedMessages } from "./stream-resync";

const TURN_BOUNDARY_AT = 1_000;
const FRESH = TURN_BOUNDARY_AT + 1;
const STALE = TURN_BOUNDARY_AT - 1;

const settledTurn = {
  isTurnInFlight: false,
  lastTurnErrored: false,
  lastTurnBoundaryAt: TURN_BOUNDARY_AT,
};

describe("shouldResyncStreamedMessages", () => {
  it("re-syncs when the streamed list holds an entry the server deduplicated away (#308)", () => {
    // Resending the text of an unanswered message reuses the saved row, so the
    // client list is one longer than the transcript forever. The old length
    // guard skipped this case, leaving the feed's tail off by one and the latest
    // reply rendered twice on every turn.
    expect(
      shouldResyncStreamedMessages({
        ...settledTurn,
        persistedFetchedAt: FRESH,
        persistedIds: ["a", "user-1", "reply-1"],
        streamedIds: ["a", "user-1", "client-resend", "client-reply"],
      }),
    ).toBe(true);
  });

  it("re-syncs when the transcript holds rows the stream never carried", () => {
    // A cross-check follow-up is persisted as its own row but streamed inside
    // the reply's single client message.
    expect(
      shouldResyncStreamedMessages({
        ...settledTurn,
        persistedFetchedAt: FRESH,
        persistedIds: ["a", "user-1", "reply-1", "followup-1"],
        streamedIds: ["a", "client-user", "client-reply"],
      }),
    ).toBe(true);
  });

  it("leaves a just-finished turn alone until a refetch from after it lands", () => {
    // The refetch triggered by onFinish has not arrived: resyncing now would
    // swap the finished reply for a transcript that does not contain it yet.
    expect(
      shouldResyncStreamedMessages({
        ...settledTurn,
        persistedFetchedAt: STALE,
        persistedIds: ["a"],
        streamedIds: ["a", "client-user", "client-reply"],
      }),
    ).toBe(false);
  });

  it("leaves the list alone while a turn is in flight", () => {
    expect(
      shouldResyncStreamedMessages({
        ...settledTurn,
        isTurnInFlight: true,
        persistedFetchedAt: FRESH,
        persistedIds: ["a", "user-1"],
        streamedIds: ["a", "client-user", "client-reply"],
      }),
    ).toBe(false);
  });

  it("keeps a failed send's unsaved message so Retry can resend it", () => {
    // Retry resends the last user message in the streamed list; replacing the
    // list with the transcript would make it resend the previous, answered one.
    expect(
      shouldResyncStreamedMessages({
        ...settledTurn,
        lastTurnErrored: true,
        persistedFetchedAt: FRESH,
        persistedIds: ["a", "reply-a"],
        streamedIds: ["a", "reply-a", "client-failed"],
      }),
    ).toBe(false);
  });

  it("does nothing when the lists already match", () => {
    expect(
      shouldResyncStreamedMessages({
        ...settledTurn,
        persistedFetchedAt: FRESH,
        persistedIds: ["a", "b"],
        streamedIds: ["a", "b"],
      }),
    ).toBe(false);
  });

  it("re-syncs lists of equal length whose ids differ", () => {
    // The usual end of a turn: the streamed entries carry client ids, the
    // persisted rows carry server ids.
    expect(
      shouldResyncStreamedMessages({
        ...settledTurn,
        persistedFetchedAt: FRESH,
        persistedIds: ["a", "user-1", "reply-1"],
        streamedIds: ["a", "client-user", "client-reply"],
      }),
    ).toBe(true);
  });
});
