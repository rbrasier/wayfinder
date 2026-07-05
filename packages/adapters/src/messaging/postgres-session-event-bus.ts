import {
  domainError,
  err,
  ok,
  parseSessionNotifyPayload,
  toSessionNotifyPayload,
  type ISessionEventBus,
  type Result,
  type SessionEvent,
  type Unsubscribe,
} from "@rbrasier/domain";

// One Postgres channel carries every session's events; the session id inside the
// payload routes each notification to the right in-process subscribers. A single
// LISTEN connection per instance (not one per session) keeps connection use flat
// as concurrency grows.
export const SESSION_EVENTS_CHANNEL = "wayfinder_session_events";

// The slice of the postgres.js driver this adapter needs. Kept as a narrow seam
// so the fan-out and publish behaviour can be tested without a live database and
// so a different transport (e.g. Redis pub/sub) could satisfy the same shape.
export interface NotifyTransport {
  notify(channel: string, payload: string): Promise<unknown>;
  listen(
    channel: string,
    onNotify: (payload: string) => void,
  ): Promise<{ unlisten: () => Promise<void> } | { unlisten: () => void }>;
}

type Handler = (event: SessionEvent) => void;

// Per-instance registry mapping a session id to its live SSE handlers. Pure and
// synchronous so the routing and teardown logic is unit-testable in isolation
// from the LISTEN/NOTIFY transport.
export class SessionEventFanout {
  private readonly handlersBySession = new Map<string, Set<Handler>>();

  add(sessionId: string, handler: Handler): () => void {
    const existing = this.handlersBySession.get(sessionId);
    const handlers = existing ?? new Set<Handler>();
    if (!existing) this.handlersBySession.set(sessionId, handlers);
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) this.handlersBySession.delete(sessionId);
    };
  }

  dispatch(sessionId: string, event: SessionEvent): void {
    const handlers = this.handlersBySession.get(sessionId);
    if (!handlers) return;
    // Copy so a handler that unsubscribes itself during dispatch cannot mutate
    // the set mid-iteration.
    for (const handler of [...handlers]) handler(event);
  }

  handlerCount(sessionId: string): number {
    return this.handlersBySession.get(sessionId)?.size ?? 0;
  }

  totalSessions(): number {
    return this.handlersBySession.size;
  }
}

export class PostgresSessionEventBus implements ISessionEventBus {
  private readonly fanout = new SessionEventFanout();
  // The LISTEN handshake is async and must happen exactly once; concurrent first
  // subscribers await the same promise rather than opening duplicate listeners.
  private listening: Promise<void> | null = null;

  constructor(private readonly transport: NotifyTransport) {}

  async publish(sessionId: string, event: SessionEvent): Promise<Result<void>> {
    try {
      await this.transport.notify(SESSION_EVENTS_CHANNEL, toSessionNotifyPayload(sessionId, event));
      return ok(undefined);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to publish session event.", cause));
    }
  }

  async subscribe(sessionId: string, handler: Handler): Promise<Result<Unsubscribe>> {
    try {
      await this.ensureListening();
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to subscribe to session events.", cause));
    }
    const remove = this.fanout.add(sessionId, handler);
    const unsubscribe: Unsubscribe = async () => {
      remove();
    };
    return ok(unsubscribe);
  }

  private ensureListening(): Promise<void> {
    if (this.listening) return this.listening;
    this.listening = this.transport
      .listen(SESSION_EVENTS_CHANNEL, (raw) => {
        const envelope = parseSessionNotifyPayload(raw);
        if (!envelope) return;
        this.fanout.dispatch(envelope.sessionId, envelope.event);
      })
      .then(() => undefined)
      .catch((cause) => {
        // Reset so a later subscribe retries the handshake rather than reusing a
        // rejected promise forever.
        this.listening = null;
        throw cause;
      });
    return this.listening;
  }
}
