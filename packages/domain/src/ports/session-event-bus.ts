import type { SessionEvent } from "../entities/session-event";
import type { Result } from "../result";

// Cancels a subscription and, once no subscribers remain for a session, tears
// down the underlying transport listener for it.
export type Unsubscribe = () => Promise<void>;

// Real-time transport for session events (scaling wall #2). The Postgres
// LISTEN/NOTIFY adapter fulfils this today; a Redis pub/sub adapter can drop in
// behind the same port later (scaling-new-infrastructure phase doc) with no
// change to the SSE route or the publishers.
export interface ISessionEventBus {
  // Broadcast an event to every subscriber of the session, across all instances.
  publish(sessionId: string, event: SessionEvent): Promise<Result<void>>;
  // Register a handler for a session's events. The returned Unsubscribe must be
  // called when the SSE connection closes so the fan-out registry stays bounded.
  subscribe(
    sessionId: string,
    handler: (event: SessionEvent) => void,
  ): Promise<Result<Unsubscribe>>;
}
