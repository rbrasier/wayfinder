# ADR-063 — Event Watch: Polling, Embedded Connection, and Item State

- **Status**: Proposed (scoped by `unattended-automation.prd.md`)
- **Date**: 2026-10-22
- **Assumes**:
  - ADR-019 (durable scheduler worker and `job_registry`)
  - ADR-041 (DB-first runtime config and settings encryption)
  - ADR-033 (audit log)
  - ADR-064 (trigger inputs)
  - ADR-065 (unattended run start and alerting)
- **Numbering**: 063, not 061, because `main` already carries ADR-061–062 and
  this ADR forward-merges there from `release/alpha-2`.

## Context

An administrator needs to check an external JSON API every N minutes and start
a flow when something happens to an item in it. The motivating case is a
Senate Estimates hearing going from `live` to `finished`. Five things need
deciding:

1. where the API address and its secret live;
2. how a non-developer picks fields from an arbitrary response;
3. how "something happened" is detected across polls;
4. how a poll is scheduled and kept from overlapping;
5. how the feature fails safely.

## Decision

### 1. One connection per watch, embedded in the watch row

A watch carries its own connection: `url`, `method` (`GET` | `POST`),
`request_body` (POST only), `auth_type` (`none` | `bearer` | `api_key`),
`api_key_placement` (`{ in: "header" | "query", name }`), and
`secret_encrypted`. They are columns on `admin_event_watches`. There is no
connections table.

The secret is encrypted with the same key and envelope as
`encrypted-system-settings-repository.ts`. That logic is extracted into a small
`SecretCipher` in `packages/adapters/src/config/` that both use. The
repository's read model returns `hasSecret: boolean`, never the secret. Only
the poller's adapter-internal path decrypts it. Updating a watch with an empty
secret field keeps the stored one. Clearing it is an explicit action.

Rejected: a shared `admin_connections` table. The requester chose one
connection per watch. The only other consumer, a "call API" data step, is out
of scope. A shared table would add a second admin page, a foreign key and
delete-in-use rules for no present benefit. Splitting the columns out later is
a mechanical migration.

### 2. Sample-and-pick, not OpenAPI

The editor's **Test** button calls `eventWatch.test`. That runs one real
request through the same `IOutboundHttpClient` the poller uses and returns the
parsed JSON, truncated to 256 KB and 2,000 nodes for display. The UI renders it
as a tree, auto-node style. The admin clicks to set:

- **Items path**: the array to iterate (e.g. `data.hearings`). May be empty
  when the response is a single object, which is then treated as a one-item
  list.
- **Item ID path**: relative to an item, used as `WatchItemState.itemId`.
  Required when items path is set.
- **Condition field path** (for `transition`, `matches`, `changed`).
- **Input mapping**: for each of the target flow's declared `TriggerInput`s
  (ADR-064), the item-relative path that supplies it.

Paths are stored as dotted strings with `[n]` indices, resolved by a pure
domain function `readJsonPath(value, path)`. No JSONPath library is used: the
picker only ever produces simple paths.

A **"would fire now"** preview evaluates the condition against the sample and
a synthetic previous state. It shows which items would start a run.

### 3. Conditions and item state

```ts
type WatchCondition =
  | { kind: "transition"; fieldPath: string; from: string | null; to: string }
  | { kind: "matches"; fieldPath: string; operator: "equals" | "not_equals" | "contains" | "regex"; value: string }
  | { kind: "new_item" }
  | { kind: "changed"; fieldPath: string };
```

`from: null` in `transition` means "from any other value".

`admin_event_watch_item_states` holds one row per `(watch_id, item_id)`:
`last_values jsonb` (the condition field and mapped input values), `fired_at`,
and `last_seen_at`. Items missing from a poll keep their row. If they come back,
the comparison is against the last value seen.

### 4. Evaluation rules

`evaluateWatchItems(condition, items, previousStates, options)` is a **pure
domain function**. It returns `{ toFire, nextStates }`:

| Kind | Fires when |
| ---- | ---------- |
| `transition` | previous value exists, ≠ current, current = `to`, and (`from` null or previous = `from`) |
| `matches` | current matches the operator. **Edge-triggered**: only when the previous poll did not match, or the item is new |
| `new_item` | no previous state for the item ID |
| `changed` | previous value exists and ≠ current |

The rules that make it safe:

- **Baseline poll.** The first successful poll after a watch is created, or
  after its URL, items path, item ID path or condition is edited, records
  state and fires nothing. `baseline_pending` is set on the row and cleared by
  that poll. Without this, a `new_item` or `matches` watch would fire once for
  every item that already exists.
- **Fire once per item.** When `fire_once_per_item` is true (the default), an
  item whose state has `fired_at` set never fires again.
- **Per-poll cap.** If `toFire.length > max_runs_per_poll` (default 20), no
  runs start. The state is **not** advanced, the watch pauses with reason
  `run_cap_exceeded`, and the owner is alerted. Advancing state would silently
  swallow the matches.
- Comparison is on the JSON-stringified value, so `1` and `"1"` differ. That is
  intended, and the editor shows the sampled type.

### 5. Scheduling: on the existing scheduler tick

> **As built (v0.28.42).** The plan was a second `EventWatchWorker` in
> `apps/api`. Every step a run needs (the AI and email steps, the run driver)
> is wired in the web app's container, and the API's scheduler is already a
> 60 s heartbeat that POSTs the web app's internal
> `/api/internal/scheduler/tick`. Polling therefore runs on that tick, after
> due schedules and the stalled-run sweep, up to 20 watches per tick. No new
> worker, `job_registry` row or environment variable was added. The tick
> skips polling while the `event_watch` flag is off.

Each tick calls the application use case `PollDueWatches`:

1. **Claim due watches.** `IEventWatchRepository.claimDue(now, limit)` uses
   `FOR UPDATE SKIP LOCKED` on `status = 'active' AND next_poll_at <= now` and
   sets `next_poll_at = now + interval` in the same statement. Two API replicas
   therefore never poll the same watch twice.
2. **Fetch.** Call the API through `IOutboundHttpClient` (§6).
3. **Evaluate and start runs.** Run `evaluateWatchItems`. For each item to
   fire, call `StartUnattendedRun` (ADR-065) with `origin: "watch"`,
   `triggerSourceId: watch.id`, and the mapped inputs.
4. **Save state.** Persist `nextStates`, with `fired_at` set only for items
   whose run actually started. An item whose run failed to start fires again
   on the next poll.
5. **Record health.** On success, reset `consecutive_failures` and set
   `last_polled_at` and `last_success_at`.

`interval_minutes` is an integer ≥ 1. The domain validator rejects lower
values. A 1-minute watch on a 60 s tick polls roughly every minute. Exact
cadence is not promised.

**Run now (amended).** An admin can check an active watch at once from the
watch list. `PollDueWatches.runNow` claims that one watch the way `claimDue` does
(skip-locked, next poll moved on by its interval) and checks it by the same rules,
so the condition, one run per item and the run cap all still apply. A watch claimed
under 30 seconds ago is left alone, since its check may still be running (a request
times out at 15 seconds) and a second check could fire an item twice. The admin
is told to try again in a few seconds. A paused watch must be resumed first.

### 6. Outbound HTTP and SSRF

A new domain port, `IOutboundHttpClient.request({ url, method, headers, body,
timeoutMs, maxBytes })`, returns `Result<{ status, json }>`. The adapter uses
`fetch` and enforces:

- **Blocked addresses.** It refuses hostnames that resolve to loopback,
  link-local (including `169.254.169.254`), RFC 1918, CGNAT and IPv6
  ULA/link-local, unless the host is listed in the `WATCH_ALLOWED_HOSTS`
  runtime setting. That setting is for on-prem APIs.

  > **Amended (v0.28.42 review):** an **empty** list now means any host may
  > be called, internal ones included, except the link-local cloud metadata
  > range (169.254.0.0/16, fe80::/10, fd00:ec2::254), which is always
  > refused. A **filled** list keeps the rule above. Explicitly listing a
  > metadata host still allows it.

  `WATCH_ALLOWED_HOSTS` and ADR-065's `EMAIL_ALLOWED_DOMAINS` are stored in
  `admin_system_settings`. Neither is sensitive, so neither is encrypted.
  Both are read through `RuntimeConfigStore` (ADR-041) and edited on a new
  **Automation** card on Admin → Settings: two newline-separated lists, with
  hostnames validated and wildcards rejected.
- **Redirects.** It follows redirects manually, at most 3, re-checking each
  hop's address.
- **Limits.** 15 s timeout, 5 MB response cap, and a response that must parse
  as JSON. Anything else is a failure with a typed reason.
- **Secrets stay out of logs.** `Authorization` and the API-key header or
  query parameter are redacted from every log line, error message and
  `last_error`.

### 7. Failure and pause

A failed poll (network error, non-2xx status, non-JSON body, a missing items
path) increments `consecutive_failures` and stores a redacted `last_error`. At
`failure_threshold` (default 5, range 1–50) the watch moves to
`status = 'paused'` and records `paused_reason` and `paused_at`, and the run
owner is alerted (ADR-065 §6). Paused watches are never claimed. **Resume**
resets the counter and sets `next_poll_at = now`. It does not re-baseline:
state from before the pause is still valid.

The watch also pauses when its run-as user is deactivated or loses access to
the flow, or when the flow is deleted or unpublished. Reasons:
`run_as_unavailable` and `flow_unavailable`.

### 8. Flag and permission

Everything is behind the `event_watch` feature flag, scoped to the **Admins**
role. The tRPC router is `adminProcedure` and also checks the flag. With the
flag off, the menu item is hidden and `PollDueWatches` claims nothing. Rows are
kept, so turning the flag back on resumes where it left off.

Create, edit, pause, resume, delete and test are audit-logged as
`event_watch.*` with the secret omitted.

## Consequences

- No new background worker: polling shares the scheduler's heartbeat (§5), so
  it has the same operational model and the same 60 s cadence.
- A secret cannot be shared across watches; an admin pastes it into each. That
  is acceptable for the expected handful of watches.
- `readJsonPath` and `evaluateWatchItems` are pure and fully unit-testable with
  no network.
- Forward-merging to `main` needs the migration renumbered and the
  `SecretCipher` extraction reconciled with `main`'s settings repository.
