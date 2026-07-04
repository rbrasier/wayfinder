import { describe, expect, it } from "vitest";
import {
  isDurableSessionEvent,
  parseSessionNotifyPayload,
  toSessionNotifyPayload,
  type SessionEvent,
} from "./session-event";

describe("session-event NOTIFY codec", () => {
  it("round-trips a message.created event through the wire payload", () => {
    const event: SessionEvent = { type: "message.created", seq: 42 };
    const payload = toSessionNotifyPayload("session-1", event);

    const parsed = parseSessionNotifyPayload(payload);

    expect(parsed).toEqual({ sessionId: "session-1", event });
  });

  it("round-trips a turn.claimed event with holder attribution", () => {
    const event: SessionEvent = { type: "turn.claimed", userId: "user-1", userName: "Alex" };
    const parsed = parseSessionNotifyPayload(toSessionNotifyPayload("session-9", event));

    expect(parsed?.sessionId).toBe("session-9");
    expect(parsed?.event).toEqual(event);
  });

  it("returns null for non-JSON payloads instead of throwing", () => {
    expect(parseSessionNotifyPayload("not json{")).toBeNull();
  });

  it("returns null when the session id is missing", () => {
    expect(parseSessionNotifyPayload(JSON.stringify({ event: { type: "typing" } }))).toBeNull();
  });

  it("returns null for an unknown event type", () => {
    const raw = JSON.stringify({ sessionId: "s", event: { type: "turn.exploded" } });
    expect(parseSessionNotifyPayload(raw)).toBeNull();
  });

  it("returns null when message.created has no numeric seq", () => {
    const raw = JSON.stringify({ sessionId: "s", event: { type: "message.created" } });
    expect(parseSessionNotifyPayload(raw)).toBeNull();
  });
});

describe("isDurableSessionEvent", () => {
  it("marks only message.created as advancing the replay cursor", () => {
    expect(isDurableSessionEvent({ type: "message.created", seq: 1 })).toBe(true);
    expect(isDurableSessionEvent({ type: "turn.released" })).toBe(false);
    expect(isDurableSessionEvent({ type: "session.updated" })).toBe(false);
    expect(isDurableSessionEvent({ type: "typing", userId: "u", userName: null })).toBe(false);
  });
});
