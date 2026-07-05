// Real-time session events (scaling wall #2). These replace the 2 s/3 s polls:
// they are published to the session event bus and fanned out to SSE subscribers.
// They are deliberately *notifications, not data* — a `message.created` carries
// only the new `seq` so the client fetches the delta via `listSinceSeq`, keeping
// every payload well under the Postgres NOTIFY 8 KB limit and multi-instance
// correct (the payload never leans on one process's memory).

// The AI turn was claimed on this session; every open window disables Send and
// can attribute the hold to a name.
export interface SessionTurnClaimedEvent {
  type: "turn.claimed";
  userId: string;
  userName: string | null;
}

// The AI turn finished (success or failure); Send re-enables.
export interface SessionTurnReleasedEvent {
  type: "turn.released";
}

// A new message was persisted. `seq` is its monotonic cursor, so a client fetches
// exactly the rows it is missing and a reconnect replays losslessly.
export interface SessionMessageCreatedEvent {
  type: "message.created";
  seq: number;
}

// Session state (status, current node, awaiting-confirmation) changed; clients
// refetch state, not the immutable flow definition.
export interface SessionUpdatedEvent {
  type: "session.updated";
}

// Ephemeral typing presence. Never persisted — it only ever travels over the bus.
export interface SessionTypingEvent {
  type: "typing";
  userId: string;
  userName: string | null;
}

export type SessionEvent =
  | SessionTurnClaimedEvent
  | SessionTurnReleasedEvent
  | SessionMessageCreatedEvent
  | SessionUpdatedEvent
  | SessionTypingEvent;

export type SessionEventType = SessionEvent["type"];

// Only `message.created` advances the durable Last-Event-ID cursor; the rest are
// transient signals a reconnect re-derives from a fresh state fetch.
export const isDurableSessionEvent = (
  event: SessionEvent,
): event is SessionMessageCreatedEvent => event.type === "message.created";

// The wire envelope carried in a single NOTIFY payload. The session id travels
// with the event so one process-wide LISTEN connection can route to the right
// in-process subscribers.
export interface SessionEventEnvelope {
  sessionId: string;
  event: SessionEvent;
}

export const toSessionNotifyPayload = (sessionId: string, event: SessionEvent): string =>
  JSON.stringify({ sessionId, event } satisfies SessionEventEnvelope);

const KNOWN_EVENT_TYPES: ReadonlySet<SessionEventType> = new Set([
  "turn.claimed",
  "turn.released",
  "message.created",
  "session.updated",
  "typing",
]);

// Parse a NOTIFY payload back into an envelope, returning null on anything
// malformed so a bad publish (or a payload from an older/newer schema) can never
// crash the single listener connection that serves the whole process.
export const parseSessionNotifyPayload = (raw: string): SessionEventEnvelope | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const candidate = parsed as { sessionId?: unknown; event?: unknown };
  if (typeof candidate.sessionId !== "string" || candidate.sessionId.length === 0) return null;
  if (typeof candidate.event !== "object" || candidate.event === null) return null;

  const event = candidate.event as { type?: unknown; seq?: unknown };
  if (typeof event.type !== "string" || !KNOWN_EVENT_TYPES.has(event.type as SessionEventType)) {
    return null;
  }
  if (event.type === "message.created" && typeof event.seq !== "number") return null;

  return { sessionId: candidate.sessionId, event: candidate.event as SessionEvent };
};
