# Bug Fix — Scheduler tick 500: bare Date params in raw claim SQL

## Symptom

`POST /api/internal/scheduler/tick` returns `500` with
`INFRA_FAILURE: Failed to claim due schedules.` on **every** tick, so no
schedule ever fires. Severity: **blocker** (scheduling is fully down).

The wrapped `INFRA_FAILURE` hides the real cause. The underlying error is:

```
TypeError: The "string" argument must be of type string or an instance of
Buffer or ArrayBuffer. Received an instance of Date
```

## Root cause (verified)

`packages/adapters/src/repositories/drizzle-schedule-repository.ts` —
`buildClaimDueStatement` builds the durable-claim UPDATE with a **raw** Drizzle
`sql` template and interpolates two JS `Date` objects (`leaseUntil`, `now`)
directly as bound parameters:

```ts
sql`
  UPDATE ${app_session_schedules}
  SET next_fire_at = ${leaseUntil}, updated_at = now()
  WHERE ... AND next_fire_at <= ${now}
  ...
`
```

`next_fire_at` is a `timestamptz` column
(`packages/adapters/src/db/schema/wayfinder.ts:207`). When you use the **typed**
Drizzle query builder, Drizzle applies that column's timestamp serializer before
handing the value to the driver. In a **raw** `sql` template there is no column
context, so Drizzle passes the raw `Date` instances straight through to
`client.unsafe(query, params)` in postgres.js. This project's postgres.js
configuration has no text encoder for a bare `Date`, so it throws while trying to
serialize the parameter — before the query ever reaches Postgres.

Confirmed facts:

- The SQL itself is valid — it runs fine in `psql`.
- The failure is purely parameter serialization; replacing the two `Date`s with
  `date.toISOString()` (with an explicit `::timestamptz` cast) makes postgres.js
  accept them.
- The existing unit test asserted the *buggy* shape (`params` contains the raw
  `Date` objects), which is why it never caught this.

## Reproduction

1. Have at least one `active` schedule due (`next_fire_at <= now`).
2. `POST /api/internal/scheduler/tick` with the shared secret header.
3. Response is `500 { "error": "Failed to claim due schedules." }`.

## Fix plan

Cast the two timestamp parameters to `timestamptz` and bind them as ISO strings
in `buildClaimDueStatement`, giving postgres.js a defined text encoding:

```ts
SET next_fire_at = ${leaseUntil.toISOString()}::timestamptz, ...
WHERE ... AND next_fire_at <= ${now.toISOString()}::timestamptz
```

The comparison stays type-correct (`timestamptz <= timestamptz`), and everything
else (`FOR UPDATE SKIP LOCKED`, the `RETURNING` clause, the durable-claim logic)
is unchanged.

## Tests

- **Regression guard (unit):** update
  `drizzle-schedule-repository.test.ts` to assert the bound timestamp params are
  serializable ISO strings (not `Date` instances) and that the rendered SQL casts
  them to `timestamptz`. Fails on the unfixed code, passes after the fix.
- **E2E:** `apps/web/e2e/fix-scheduler-tick-timestamp-serialization.spec.ts`
  drives `POST /api/internal/scheduler/tick` and asserts a non-500 response with a
  `data` body. Fails (500) on unfixed code, passes after the fix.

## Version

PATCH bump: `1.58.0` → `1.58.1` (bug fix, no schema impact).

---

## Implementation summary (v1.58.1)

**Root cause:** `buildClaimDueStatement` interpolated bare `Date` objects
(`leaseUntil`, `now`) into a raw Drizzle `sql` template. A raw template applies
no column serializer, so postgres.js received the `Date` instances directly and
threw `TypeError: The "string" argument must be of type string ... Received an
instance of Date` during parameter serialization — before the query reached
Postgres. The tick wrapped this as `INFRA_FAILURE: Failed to claim due
schedules.` and returned 500 on every call.

**Fix applied:**
`packages/adapters/src/repositories/drizzle-schedule-repository.ts` —
`buildClaimDueStatement` now binds each timestamp as an ISO string with an
explicit `::timestamptz` cast: `${leaseUntil.toISOString()}::timestamptz` in the
`SET`, and `next_fire_at <= ${now.toISOString()}::timestamptz` in the `WHERE`.
ISO strings give postgres.js a defined text encoding; the cast keeps the
comparison `timestamptz <= timestamptz`. The `FOR UPDATE SKIP LOCKED`, the
`RETURNING` clause, and the durable-claim logic are unchanged.

**Regression test added (unit):**
`packages/adapters/src/repositories/drizzle-schedule-repository.test.ts` — the
existing "leases forward" assertions now expect the ISO-string params, and a new
case ("binds the timestamps as serializable ISO strings cast to timestamptz")
asserts no param is a `Date`, both timestamps are present as ISO strings, and
the SQL contains `::timestamptz`. This case fails on the unfixed code and passes
after the fix.

**E2E test added:**
`tests/e2e/fix-scheduler-tick-timestamp-serialization.spec.ts` — posts an
authenticated tick (`x-scheduler-secret`) and asserts a non-500 response with a
`data` body. On the unfixed code the claim throws and the endpoint returns 500
`{ error: "Failed to claim due schedules." }`. `SCHEDULER_TICK_SECRET` was added
to `.github/workflows/e2e.yml` so the authenticated path is reachable in CI (the
spec skips when the secret is unset).
