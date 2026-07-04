import { describe, expect, it, vi } from "vitest";
import type { SessionEvent } from "@rbrasier/domain";
import {
  PostgresSessionEventBus,
  SessionEventFanout,
  SESSION_EVENTS_CHANNEL,
  type NotifyTransport,
} from "./postgres-session-event-bus";

// A fake transport that captures NOTIFY calls and lets a test drive an incoming
// notification into the registered listener, standing in for a live Postgres
// LISTEN/NOTIFY round-trip.
class FakeTransport implements NotifyTransport {
  notified: { channel: string; payload: string }[] = [];
  listenCalls = 0;
  private incoming: ((payload: string) => void) | null = null;

  async notify(channel: string, payload: string): Promise<unknown> {
    this.notified.push({ channel, payload });
    return undefined;
  }

  async listen(channel: string, onNotify: (payload: string) => void) {
    this.listenCalls += 1;
    this.incoming = onNotify;
    return { unlisten: async () => undefined };
  }

  deliver(payload: string): void {
    this.incoming?.(payload);
  }
}

describe("SessionEventFanout", () => {
  it("routes an event only to handlers of the same session", () => {
    const fanout = new SessionEventFanout();
    const forOne = vi.fn();
    const forTwo = vi.fn();
    fanout.add("session-1", forOne);
    fanout.add("session-2", forTwo);

    fanout.dispatch("session-1", { type: "session.updated" });

    expect(forOne).toHaveBeenCalledWith({ type: "session.updated" });
    expect(forTwo).not.toHaveBeenCalled();
  });

  it("stops delivering after unsubscribe and prunes the empty session", () => {
    const fanout = new SessionEventFanout();
    const handler = vi.fn();
    const remove = fanout.add("session-1", handler);

    remove();
    fanout.dispatch("session-1", { type: "turn.released" });

    expect(handler).not.toHaveBeenCalled();
    expect(fanout.totalSessions()).toBe(0);
  });
});

describe("PostgresSessionEventBus", () => {
  it("publishes an event as one NOTIFY on the shared channel", async () => {
    const transport = new FakeTransport();
    const bus = new PostgresSessionEventBus(transport);
    const event: SessionEvent = { type: "message.created", seq: 7 };

    const result = await bus.publish("session-1", event);

    expect(result.error).toBeUndefined();
    expect(transport.notified).toHaveLength(1);
    expect(transport.notified[0]?.channel).toBe(SESSION_EVENTS_CHANNEL);
    expect(JSON.parse(transport.notified[0]!.payload)).toEqual({ sessionId: "session-1", event });
  });

  it("delivers an incoming notification to the matching subscriber", async () => {
    const transport = new FakeTransport();
    const bus = new PostgresSessionEventBus(transport);
    const handler = vi.fn();
    await bus.subscribe("session-1", handler);

    transport.deliver(JSON.stringify({ sessionId: "session-1", event: { type: "turn.released" } }));

    expect(handler).toHaveBeenCalledWith({ type: "turn.released" });
  });

  it("opens the LISTEN connection exactly once across many subscribers", async () => {
    const transport = new FakeTransport();
    const bus = new PostgresSessionEventBus(transport);

    await Promise.all([
      bus.subscribe("session-1", vi.fn()),
      bus.subscribe("session-2", vi.fn()),
      bus.subscribe("session-3", vi.fn()),
    ]);

    expect(transport.listenCalls).toBe(1);
  });

  it("ignores a malformed notification without throwing", async () => {
    const transport = new FakeTransport();
    const bus = new PostgresSessionEventBus(transport);
    const handler = vi.fn();
    await bus.subscribe("session-1", handler);

    expect(() => transport.deliver("not json{")).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it("surfaces a transport failure as an INFRA_FAILURE result", async () => {
    const transport = new FakeTransport();
    transport.notify = async () => {
      throw new Error("connection reset");
    };
    const bus = new PostgresSessionEventBus(transport);

    const result = await bus.publish("session-1", { type: "session.updated" });

    expect(result.error?.code).toBe("INFRA_FAILURE");
  });
});
