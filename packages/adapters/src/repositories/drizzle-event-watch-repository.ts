import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import {
  domainError,
  err,
  ok,
  type EventWatch,
  type EventWatchUpdate,
  type IEventWatchRepository,
  type NewEventWatch,
  type Result,
  type SecretChange,
  type WatchItemState,
  type WatchPausedReason,
} from "@wayfinder/domain";
import type { Database } from "../db/client";
import { admin_event_watch_item_states, admin_event_watches } from "../db/schema/admin";
import type { SecretCipher } from "./drizzle-flow-trigger-repository";

type EventWatchRow = typeof admin_event_watches.$inferSelect;

export const toEventWatch = (row: EventWatchRow): EventWatch => ({
  id: row.id,
  name: row.name,
  url: row.url,
  method: row.method,
  requestBody: row.request_body ?? null,
  authType: row.auth_type,
  apiKeyPlacement: row.api_key_placement ?? null,
  hasSecret: row.secret_encrypted !== null,
  intervalMinutes: row.interval_minutes,
  itemsPath: row.items_path,
  itemIdPath: row.item_id_path,
  condition: row.condition,
  fireOncePerItem: row.fire_once_per_item,
  maxRunsPerPoll: row.max_runs_per_poll,
  flowId: row.flow_id,
  inputMapping: row.input_mapping,
  runAsUserId: row.run_as_user_id,
  status: row.status,
  baselinePending: row.baseline_pending,
  consecutiveFailures: row.consecutive_failures,
  failureThreshold: row.failure_threshold,
  lastError: row.last_error ?? null,
  pausedReason: row.paused_reason ?? null,
  pausedAt: row.paused_at ?? null,
  pauseIncidentId: row.pause_incident_id ?? null,
  lastPolledAt: row.last_polled_at ?? null,
  lastSuccessAt: row.last_success_at ?? null,
  nextPollAt: row.next_poll_at ?? null,
  createdBy: row.created_by ?? null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

// Durable claim, as the scheduler's (ADR-019): one UPDATE takes the due rows
// with SKIP LOCKED and pushes each next poll on by its own interval, so a
// concurrent poller or a retried tick never polls the same watch twice.
export const buildClaimDueWatchesStatement = (now: Date, limit: number): SQL => sql`
  UPDATE ${admin_event_watches}
  SET next_poll_at = ${now.toISOString()}::timestamptz + make_interval(mins => interval_minutes),
      updated_at = now()
  WHERE id IN (
    SELECT id FROM ${admin_event_watches}
    WHERE status = 'active'
      AND (next_poll_at IS NULL OR next_poll_at <= ${now.toISOString()}::timestamptz)
    ORDER BY next_poll_at ASC NULLS FIRST
    LIMIT ${limit}
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *
`;

// "Run now" takes one watch the same way. A watch's last claim was at
// next_poll_at minus its interval; one claimed under 30 seconds ago may still be
// mid-check (a request times out at 15), and checking it again could fire an
// item twice, so it is left alone.
export const buildClaimWatchNowStatement = (id: string, now: Date): SQL => sql`
  UPDATE ${admin_event_watches}
  SET next_poll_at = ${now.toISOString()}::timestamptz + make_interval(mins => interval_minutes),
      updated_at = now()
  WHERE id IN (
    SELECT id FROM ${admin_event_watches}
    WHERE id = ${id}
      AND status = 'active'
      AND (
        next_poll_at IS NULL
        OR next_poll_at - make_interval(mins => interval_minutes)
          <= ${now.toISOString()}::timestamptz - interval '30 seconds'
      )
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *
`;

// The poll path reads the raw row back from `RETURNING *`, whose column names
// are the snake_case ones the schema declares.
const toEventWatchFromRaw = (row: Record<string, unknown>): EventWatch =>
  toEventWatch({
    ...(row as unknown as EventWatchRow),
    created_at: new Date(row.created_at as string),
    updated_at: new Date(row.updated_at as string),
    paused_at: row.paused_at ? new Date(row.paused_at as string) : null,
    last_polled_at: row.last_polled_at ? new Date(row.last_polled_at as string) : null,
    last_success_at: row.last_success_at ? new Date(row.last_success_at as string) : null,
    next_poll_at: row.next_poll_at ? new Date(row.next_poll_at as string) : null,
  });

const columnsFor = (patch: EventWatchUpdate): Partial<typeof admin_event_watches.$inferInsert> => ({
  ...(patch.name !== undefined ? { name: patch.name } : {}),
  ...(patch.url !== undefined ? { url: patch.url } : {}),
  ...(patch.method !== undefined ? { method: patch.method } : {}),
  ...(patch.requestBody !== undefined ? { request_body: patch.requestBody } : {}),
  ...(patch.authType !== undefined ? { auth_type: patch.authType } : {}),
  ...(patch.apiKeyPlacement !== undefined ? { api_key_placement: patch.apiKeyPlacement } : {}),
  ...(patch.intervalMinutes !== undefined ? { interval_minutes: patch.intervalMinutes } : {}),
  ...(patch.itemsPath !== undefined ? { items_path: patch.itemsPath } : {}),
  ...(patch.itemIdPath !== undefined ? { item_id_path: patch.itemIdPath } : {}),
  ...(patch.condition !== undefined ? { condition: patch.condition } : {}),
  ...(patch.fireOncePerItem !== undefined ? { fire_once_per_item: patch.fireOncePerItem } : {}),
  ...(patch.maxRunsPerPoll !== undefined ? { max_runs_per_poll: patch.maxRunsPerPoll } : {}),
  ...(patch.failureThreshold !== undefined ? { failure_threshold: patch.failureThreshold } : {}),
  ...(patch.flowId !== undefined ? { flow_id: patch.flowId } : {}),
  ...(patch.inputMapping !== undefined ? { input_mapping: patch.inputMapping } : {}),
  ...(patch.runAsUserId !== undefined ? { run_as_user_id: patch.runAsUserId } : {}),
  ...(patch.baselinePending !== undefined ? { baseline_pending: patch.baselinePending } : {}),
});

const failure = (message: string, cause: unknown) => err(domainError("INFRA_FAILURE", message, cause));

export class DrizzleEventWatchRepository implements IEventWatchRepository {
  constructor(
    private readonly db: Database,
    private readonly cipher: SecretCipher,
  ) {}

  private encrypted(secret: SecretChange): { secret_encrypted?: string | null } {
    if (secret === undefined) return {};
    return { secret_encrypted: secret === null ? null : this.cipher.encrypt(secret) };
  }

  async list(): Promise<Result<EventWatch[]>> {
    try {
      const rows = await this.db.select().from(admin_event_watches).orderBy(asc(admin_event_watches.name));
      return ok(rows.map(toEventWatch));
    } catch (cause) {
      return failure("Failed to list event watches.", cause);
    }
  }

  async findById(id: string): Promise<Result<EventWatch | null>> {
    try {
      const [row] = await this.db.select().from(admin_event_watches).where(eq(admin_event_watches.id, id)).limit(1);
      return ok(row ? toEventWatch(row) : null);
    } catch (cause) {
      return failure("Failed to load the event watch.", cause);
    }
  }

  async create(input: NewEventWatch, secret: SecretChange): Promise<Result<EventWatch>> {
    try {
      const [row] = await this.db
        .insert(admin_event_watches)
        .values({
          ...(columnsFor(input) as typeof admin_event_watches.$inferInsert),
          ...this.encrypted(secret),
          created_by: input.createdBy,
          baseline_pending: true,
          next_poll_at: new Date(),
        })
        .returning();
      if (!row) return err(domainError("INFRA_FAILURE", "Event watch insert returned no row."));
      return ok(toEventWatch(row));
    } catch (cause) {
      return failure("Failed to create the event watch.", cause);
    }
  }

  async update(id: string, patch: EventWatchUpdate, secret: SecretChange): Promise<Result<EventWatch>> {
    return this.updateRow(id, { ...columnsFor(patch), ...this.encrypted(secret) });
  }

  async delete(id: string): Promise<Result<void>> {
    try {
      await this.db.delete(admin_event_watches).where(eq(admin_event_watches.id, id));
      return ok(undefined);
    } catch (cause) {
      return failure("Failed to delete the event watch.", cause);
    }
  }

  async getSecret(id: string): Promise<Result<string | null>> {
    try {
      const [row] = await this.db
        .select({ secret: admin_event_watches.secret_encrypted })
        .from(admin_event_watches)
        .where(eq(admin_event_watches.id, id))
        .limit(1);
      return ok(row?.secret ? this.cipher.decrypt(row.secret) : null);
    } catch (cause) {
      return failure("Failed to read the watch's secret.", cause);
    }
  }

  async claimDue(now: Date, limit: number): Promise<Result<EventWatch[]>> {
    try {
      const rows = (await this.db.execute(buildClaimDueWatchesStatement(now, limit))) as unknown as Record<
        string,
        unknown
      >[];
      return ok(rows.map(toEventWatchFromRaw));
    } catch (cause) {
      return failure("Failed to claim due event watches.", cause);
    }
  }

  async claimNow(id: string, now: Date): Promise<Result<EventWatch | null>> {
    try {
      const rows = (await this.db.execute(buildClaimWatchNowStatement(id, now))) as unknown as Record<
        string,
        unknown
      >[];
      return ok(rows[0] ? toEventWatchFromRaw(rows[0]) : null);
    } catch (cause) {
      return failure("Failed to claim the event watch.", cause);
    }
  }

  async recordSuccess(id: string, at: Date): Promise<Result<void>> {
    const updated = await this.updateRow(id, {
      consecutive_failures: 0,
      last_error: null,
      last_polled_at: at,
      last_success_at: at,
      baseline_pending: false,
    });
    return updated.error ? updated : ok(undefined);
  }

  async recordFailure(id: string, at: Date, message: string): Promise<Result<EventWatch>> {
    return this.updateRow(id, {
      consecutive_failures: sql`${admin_event_watches.consecutive_failures} + 1`,
      last_error: message,
      last_polled_at: at,
    });
  }

  async pause(id: string, reason: WatchPausedReason, at: Date, incidentId: string): Promise<Result<EventWatch>> {
    return this.updateRow(id, { status: "paused", paused_reason: reason, paused_at: at, pause_incident_id: incidentId });
  }

  async resume(id: string, at: Date): Promise<Result<EventWatch>> {
    return this.updateRow(id, {
      status: "active",
      paused_reason: null,
      paused_at: null,
      consecutive_failures: 0,
      next_poll_at: at,
    });
  }

  async getItemStates(watchId: string, itemIds: string[]): Promise<Result<WatchItemState[]>> {
    if (itemIds.length === 0) return ok([]);
    try {
      const rows = await this.db
        .select()
        .from(admin_event_watch_item_states)
        .where(
          and(
            eq(admin_event_watch_item_states.watch_id, watchId),
            inArray(admin_event_watch_item_states.item_id, itemIds),
          ),
        );
      return ok(
        rows.map((row) => ({
          watchId: row.watch_id,
          itemId: row.item_id,
          lastValues: row.last_values,
          firedAt: row.fired_at ?? null,
          lastSeenAt: row.last_seen_at,
        })),
      );
    } catch (cause) {
      return failure("Failed to read the watch's item state.", cause);
    }
  }

  async saveItemStates(
    watchId: string,
    states: Array<{ itemId: string; lastValues: Record<string, unknown> }>,
    seenAt: Date,
  ): Promise<Result<void>> {
    if (states.length === 0) return ok(undefined);
    try {
      await this.db
        .insert(admin_event_watch_item_states)
        .values(
          states.map((state) => ({
            watch_id: watchId,
            item_id: state.itemId,
            last_values: state.lastValues,
            last_seen_at: seenAt,
          })),
        )
        .onConflictDoUpdate({
          target: [admin_event_watch_item_states.watch_id, admin_event_watch_item_states.item_id],
          set: {
            last_values: sql`excluded.last_values`,
            last_seen_at: sql`excluded.last_seen_at`,
            updated_at: new Date(),
          },
        });
      return ok(undefined);
    } catch (cause) {
      return failure("Failed to save the watch's item state.", cause);
    }
  }

  async markFired(watchId: string, itemIds: string[], at: Date): Promise<Result<void>> {
    if (itemIds.length === 0) return ok(undefined);
    try {
      await this.db
        .update(admin_event_watch_item_states)
        .set({ fired_at: at, updated_at: new Date() })
        .where(
          and(
            eq(admin_event_watch_item_states.watch_id, watchId),
            inArray(admin_event_watch_item_states.item_id, itemIds),
          ),
        );
      return ok(undefined);
    } catch (cause) {
      return failure("Failed to mark items as fired.", cause);
    }
  }

  private async updateRow(
    id: string,
    patch: Partial<Record<keyof typeof admin_event_watches.$inferInsert, unknown>>,
  ): Promise<Result<EventWatch>> {
    try {
      const [row] = await this.db
        .update(admin_event_watches)
        .set({ ...(patch as Partial<typeof admin_event_watches.$inferInsert>), updated_at: new Date() })
        .where(eq(admin_event_watches.id, id))
        .returning();
      if (!row) return err(domainError("NOT_FOUND", `Event watch ${id} not found.`));
      return ok(toEventWatch(row));
    } catch (cause) {
      return failure("Failed to update the event watch.", cause);
    }
  }
}
