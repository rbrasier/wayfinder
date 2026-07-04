import postgres from "postgres";
import { PostgresSessionEventBus, type NotifyTransport } from "./postgres-session-event-bus";

// Builds the LISTEN/NOTIFY event bus on its own postgres.js client, separate from
// the app query pool. postgres.js opens a dedicated (session-mode) connection for
// LISTEN internally and reconnects/re-subscribes automatically, so `listenUrl`
// must be a direct database URL — not a transaction-mode pooler, which cannot
// hold a LISTEN. On the current stack that is just `DATABASE_URL`; once a pooler
// is introduced, point `DATABASE_LISTEN_URL` at the direct endpoint (see the
// scaling-new-infrastructure phase doc).
export const createPostgresSessionEventBus = (listenUrl: string): PostgresSessionEventBus => {
  // A tiny pool: `notify` issues a `pg_notify` query on this client, while the
  // LISTEN connection is managed separately by postgres.js.
  const client = postgres(listenUrl, { max: 2 });
  const transport: NotifyTransport = {
    notify: (channel, payload) => client.notify(channel, payload),
    listen: (channel, onNotify) => client.listen(channel, onNotify),
  };
  return new PostgresSessionEventBus(transport);
};
