# Phase — Unattended Automation (Event Watch, Webhook Start, AI Task & Email Steps)

- **Status**: Draft — awaiting `/doc-review`
- **Target version**: **0.28.40** (PATCH, by **explicit requester exception**;
  see §10). It would otherwise be MINOR: there are schema changes and new
  features.
- **Base branch**: `release/alpha-2`, by **explicit requester exception** to
  `CLAUDE.md`'s "new features land on `main`". Implemented docs go to
  `docs/development/implemented/alpha-2/v0.28.40/`.
- **PRD**: `docs/development/prd/unattended-automation.prd.md`
- **ADRs**:
  - `063-event-watch-polling-and-embedded-connection.adr.md`
  - `064-flow-triggers-webhook-and-inputs.adr.md`
  - `065-unattended-runs-ownership-steps-and-alerts.adr.md`
- **Issue**: rbrasier/wayfinder#334 (revised approach posted there)
- **Depends on**:
  - ADR-015 (versioning)
  - ADR-018 (approver resolution)
  - ADR-019 (scheduler worker)
  - ADR-020 (step outputs)
  - ADR-033 (audit)
  - ADR-041 (settings encryption)

## 1. Problem

No Wayfinder session can start or advance without a person. Event-driven work,
such as summarising a Senate Estimates hearing as soon as it finishes, needs
someone to notice, start a flow and send the result by hand. See PRD §1.

## 2. Goals

1. **Event Watch.** Poll any JSON API every N minutes (min 1) and start one run
   for each item that meets a condition.
2. **Webhook start.** Each flow can have a secure start address that takes
   validated inputs.
3. **AI task step.** Unattended AI instruction, with low-confidence results
   going to a reviewer.
4. **Email step.** Results to users, groups and shared inboxes, with optional
   attachments.
5. **Run history and alerts.** Shown on the watch list and the flow Triggers
   tab; one email per incident to the run owner.
6. **Flags and roles.** Feature-flagged (on by default) and role-scoped: Event
   Watch to Admins, AI task and Email to Power Users.

## 3. Non-goals

- Shared Connections, OpenAPI import, Basic auth and OAuth2.
- Non-JSON or push sources, and sub-minute polling.
- A standalone Run Monitor page.
- Email recipients taken from flow data, and Slack or Teams alerts.
- A "call API" data step, and a sweeper that resumes stuck runs.

(PRD §4, §11.)

## 4. Approved change summary

> Approved by the requester on 2026-10-22 (after one amend round: Connections
> folded into the watch, Run Monitor folded into the watch list, version
> 0.28.40).

An admin builds an **Event Watch** under its own Admin menu item. The watch
holds its own web address and encrypted token, polls every N minutes, and
starts one flow run for each item that meets a condition. Flows can also be
started by a secured **webhook**. Two new step types do the work: an **AI task**
step that runs an instruction unattended and sends low-confidence results to a
reviewer, and an **Email** step that sends results to people, groups or shared
inboxes. Run history and failure alerts are on the Event Watch list and the
flow's Triggers tab. Everything is flagged and permissioned, and it ships on
`release/alpha-2` as `0.28.40`.

**Business rules**

- **Watch conditions.** Four kinds: `transition` (X → Y), `matches`,
  `new_item`, `changed`. Each matching item starts one run.
- **Watch safety.** The first poll records a baseline and starts nothing.
  "Fire once per item" is on by default. More than 20 matches in one poll
  starts nothing and pauses the watch.
- **Watch failures.** 5 consecutive poll errors (configurable 1–50) pause the
  watch, and the owner is alerted once per pause.
- **Webhook.** Off by default for each flow. A bearer token, shown once and
  rotatable, plus optional HMAC. 60 calls a minute per flow. Invalid inputs get
  a `400` and start no run. Enabling one requires the new
  `flow:webhook_trigger` permission (Power Users by default; admins always)
  **and** ownership of the flow. Admins can enable one on any flow.
- **Run owner.** A named "run as" user per watch or webhook owns the session.
  The watch pauses if that user becomes inactive or loses access to the flow.
- **Hand-off.** An AI task below its threshold goes to a reviewer, who can
  accept, edit or reject. The reviewer is the run owner, an approval-style
  approver, or a named user; there is no group reviewer (decided at
  `/doc-review`). Conversational and approval steps hand off to a person and
  wait.
- **Disabled step types.** A run reaching an AI task or Email step whose flag
  is off fails with `feature_disabled` and can be retried once the flag is
  back on.
- **Email.** Recipients are users, groups (expanded at send time) and fixed
  addresses. Fixed addresses are checked against an optional domain
  allow-list. Prior-step docx and xlsx files can be attached.
- **Flags.** `event_watch` (Admins), `ai_task_node` (Power Users) and
  `email_node` (Power Users) are all on by default.

**UI**: Admin → Event Watch (list, editor, run history, incident badge), the
flow Triggers tab, and the AI task and Email step cards. See §6.

## 5. Approach

Build strictly bottom-up within each sub-phase (domain → application →
adapters → apps), writing each test file before its implementation file
(`CLAUDE.md`). Each sub-phase is independently shippable behind its flag and
ends with a green `./validate.sh`. All three ship in 0.28.40. The split is for
review and test granularity, not separate releases.

- **Sub-phase A: AI task and Email steps** (no trigger yet; usable in manual
  sessions). Also the shared foundations: the `SecretCipher` extraction, the
  migration, and the flag seeds and backfill.
- **Sub-phase B: Trigger inputs, the unattended driver, and webhook start.**
  Also run history on the flow Triggers tab, and alerts.
- **Sub-phase C: Event Watch.** The outbound HTTP client, the poller, the admin
  UI, run history and the badge.

The schema migration and the seed migration (§7) cover all three sub-phases.
Both are created in A, so 0.28.40 carries one migrate step.

## 6. Key entities / files

### Domain (`packages/domain/src`)

| File | Change |
| ---- | ------ |
| `entities/flow-node.ts` | `FlowNodeType` adds `"ai_task" \| "email"`; add `AiTaskNodeConfig`, `AiTaskReviewer`, `EmailNodeConfig`, `EmailRecipient` (ADR-065 §3–4) |
| `entities/field-value-source.ts` | add `{ kind: "trigger_input"; inputKey: string }` |
| `entities/flow-trigger.ts` | new: `TriggerInput`, `FlowTrigger`, `validateTriggerPayload()` (pure) |
| `entities/flow-version.ts` | `FlowSnapshotMeta.triggerInputs?: TriggerInput[]` |
| `entities/flow.ts` | `Flow.triggerInputs?: TriggerInput[] \| null` |
| `entities/event-watch.ts` | new: `EventWatch`, `WatchCondition`, `WatchItemState`, `WatchPausedReason`, `readJsonPath()`, `evaluateWatchItems()`, `validateEventWatch()` (all pure) |
| `entities/session.ts` | `SessionOrigin`; `origin`, `triggerSourceId`, `triggerPayload`, `runError` on `Session`/`NewSession`; `UnattendedRunStatus` + `deriveRunStatus()` (pure) |
| `entities/notification-log.ts` | `NotificationTrigger` adds `unattended_run_failed`, `unattended_awaiting_person`, `watch_paused`; `NotificationResourceType` adds `event_watch` (text columns, no migration) |
| `entities/permission.ts` | `PermissionKey` + `PERMISSIONS` add `flow:webhook_trigger` ("Start flows via webhook") |
| `entities/approval.ts` | the stored approver-source union (line 6) adds `run_owner`, `named_user` (text column, no migration; ADR-065 §3) |
| `entities/runtime-config.ts` | `AutomationConfig { watchAllowedHosts: string[]; emailAllowedDomains: string[] }` + validator |
| `ports/email-sender.ts` | `SendEmailInput.attachments?` |
| `ports/outbound-http-client.ts` | new: `IOutboundHttpClient` |
| `ports/event-watch-repository.ts` | new: `list`, `findById`, `create`, `update`, `delete`, `claimDue(now, limit)`, `recordSuccess`, `recordFailure`, `pause`, `resume`, `getItemStates(watchId, itemIds)`, `saveItemStates`, `countNeedingAttention` |
| `ports/flow-trigger-repository.ts` | new: `findByFlow`, `findByTokenHash`, `upsert`, `setEnabled`, `rotateToken`, `setHmacSecret`, `getHmacSecret` |
| `ports/session-repository.ts` | `listByTriggerSource(sourceId, cursor)`, `setRunError`, `clearRunError` |

### Application (`packages/application/src/use-cases`)

| File | Change |
| ---- | ------ |
| `session/run-ai-task-node.ts` | new (ADR-065 §3) |
| `session/run-email-node.ts` | new (ADR-065 §4) |
| `session/start-unattended-run.ts` | new: run-as checks, version pin, session create with origin/payload, kick driver |
| `session/advance-unattended-run.ts` | new: driver loop, lease, 50-step cap, stop on human node, `run_error` on failure |
| `session/retry-failed-step.ts` | new |
| `session/apply-auto-node-result.ts`, approval decide, schedule-fire handler, conversational advance | re-enter `AdvanceUnattendedRun` when `origin !== "manual"` |
| `approvals/decide-approval.ts` | `ai_task` subject: accept (with edits) commits draft outputs; reject fails run |
| `notifications/notify-unattended-incident.ts` | new: enqueue the three triggers to the run owner |
| `flow-trigger/*` | new: `enable-webhook`, `disable-webhook`, `rotate-webhook-token`, `set-webhook-hmac`, `set-trigger-inputs`, `start-flow-from-webhook`, `list-trigger-runs` |
| `event-watch/*` | new: `create`, `update` (sets `baseline_pending` when source/condition changed), `delete`, `test-event-watch`, `preview-event-watch`, `pause`, `resume`, `poll-due-watches`, `count-needing-attention` |
| field-value resolver (where `step_field` is resolved) | resolve `trigger_input` |

### Adapters (`packages/adapters/src`)

| File | Change |
| ---- | ------ |
| `config/secret-cipher.ts` | new: extracted from `encrypted-system-settings-repository.ts` (which then uses it; behaviour unchanged, covered by its existing tests) |
| `db/schema/admin.ts` | `admin_event_watches`, `admin_event_watch_item_states` |
| `db/schema/wayfinder.ts` | `app_flow_triggers`; `app_flows.trigger_inputs`; `app_sessions` new columns + index |
| `repositories/drizzle-event-watch-repository.ts` | new; `claimDue` uses `FOR UPDATE SKIP LOCKED` |
| `repositories/drizzle-flow-trigger-repository.ts` | new |
| `http/fetch-outbound-http-client.ts` | new: SSRF guard, manual redirects, size/time caps, redaction (ADR-063 §6) |
| `scheduling/event-watch-worker.ts` | new: mirrors `SchedulerWorker`; job `event_watch_worker` |
| `email/nodemailer-email-sender.ts` | pass attachments |
| `auth/seed-roles.ts` | add `ai_task_node`, `email_node` to `POWER_USER_SCOPED_FLAGS`; add an `ADMIN_SCOPED_FLAGS = ["event_watch"]` list for fresh installs; add `flow:webhook_trigger` to Power Users' `defaultPermissions` |
| `config/runtime-config-store.ts` (existing store) | `getAutomationConfig()` / `invalidateAutomation()`, setting key `AUTOMATION_CONFIG_SETTING_KEY` (not sensitive, not encrypted) |
| `factory.ts` / `bootstrap.ts` | wire repositories, client, worker |

### Apps

| File | Change |
| ---- | ------ |
| `apps/api/src/routes/triggers.ts` | new: `POST /triggers/:flowId` (ADR-064 §3); mount with raw-body capture |
| `apps/api/src/routes/webhook-signature.ts` | `verifySignature` moved here from `webhooks.ts`, shared |
| `apps/api/src/container.ts`, `index.ts` | wire use cases; start/stop `EventWatchWorker` with the scheduler |
| `apps/web/src/server/routers/event-watch.ts` | new admin router (flag-checked) |
| `apps/web/src/server/routers/flow-trigger.ts` | new router: mutations require `flow:webhook_trigger` **and** flow ownership (or admin) |
| Admin → Settings: Automation card | new card editing `AutomationConfig` (two newline lists; validated) |
| `apps/web/src/app/(admin)/admin/event-watches/**` | new list, editor, `[id]/runs` |
| `apps/web/src/components/sidebar.tsx` | **Event Watch** item under Admin, flag-gated, badge from `eventWatch.countNeedingAttention` |
| `apps/web/src/components/json-field-picker/**` | new: tree picker for sample JSON (reuses auto-node field-row styling) |
| flow editor: Triggers tab | new tab: webhook panel + trigger inputs + run history |
| step editor: AI task / Email cards; node palette | new cards, flag-gated; "Trigger inputs" group in every `FieldValueSource` picker |
| approval decision UI | editable outputs for `ai_task` subjects |

## 7. Database & migration

There are two migrations, following the precedent of
`0039_seed_extraction_flows_flag.sql`:

1. **Schema:** generated with `pnpm db:generate` and never edited by hand.
2. **Seeds:** a separate custom migration, created with
   `pnpm db:generate --custom --name seed_unattended_automation`. The root
   script forwards to `drizzle-kit generate`. It holds the seed and backfill
   SQL below.

Never `push`. Both ship in 0.28.40.

**`admin_event_watches`**

- Standard columns: `id`, `created_at`, `updated_at`.
- Watch definition: `name`, `url`, `method`, `request_body jsonb`,
  `auth_type`, `api_key_placement jsonb`, `secret_encrypted`.
- Polling: `interval_minutes int not null`, `items_path`, `item_id_path`,
  `condition jsonb not null`, `fire_once_per_item bool not null default true`,
  `max_runs_per_poll int not null default 20`.
- Target flow: `flow_id uuid not null → app_flows (restrict)`,
  `input_mapping jsonb not null default '{}'`, `run_as_user_id uuid not null →
  core_users`.
- Health and pause state: `status text not null default 'active'`,
  `baseline_pending bool not null default true`,
  `consecutive_failures int not null default 0`,
  `failure_threshold int not null default 5`, `last_error`,
  `paused_reason`, `paused_at`, `pause_incident_id uuid`.
- Timestamps: `last_polled_at`, `last_success_at`, `next_poll_at`.
- Audit: `created_by`.
- Index: `(status, next_poll_at)`.

**`admin_event_watch_item_states`**

- Columns: `id`, `watch_id → admin_event_watches (cascade)`, `item_id text`,
  `last_values jsonb`, `fired_at`, `last_seen_at`, `created_at`, `updated_at`.
- Unique index on `(watch_id, item_id)`.

**`app_flow_triggers`**

- Columns: `id`, `flow_id → app_flows (cascade)`, `kind text not null`,
  `enabled bool not null default false`, `token_hash`, `token_last_four`,
  `hmac_secret_encrypted`, `run_as_user_id → core_users`, `created_by`,
  `last_triggered_at`, `created_at`, `updated_at`.
- Unique index on `(flow_id, kind)`; unique index on `token_hash`.

**`app_flows`**: add `trigger_inputs jsonb` (nullable).

**`app_sessions`**

- Add `origin text not null default 'manual'`, `trigger_source_id uuid`,
  `trigger_payload jsonb` and `run_error jsonb`.
- Index `(trigger_source_id, created_at)`.

**Seeds** (appended):

```sql
INSERT INTO "core_feature_flag" ("key", "enabled", "rollout_pct", "description") VALUES
  ('event_watch',  true, 100, 'Admin Event Watch: poll external APIs and start flows'),
  ('ai_task_node', true, 100, 'AI task step: unattended AI instruction with reviewer fallback'),
  ('email_node',   true, 100, 'Email step: send results to users, groups and inboxes')
ON CONFLICT ("key") DO NOTHING;

-- Backfill role scoping for installs whose system roles already exist:
-- seed-roles.ts only scopes flags when it creates the Power Users role, so an
-- upgraded install would otherwise expose these flags to everyone.
INSERT INTO "admin_feature_flag_roles" ("flag_key", "role_id")
SELECT f.key, r.id FROM (VALUES ('ai_task_node','power_users'),('email_node','power_users'),('event_watch','admins')) AS f(key, role_key)
JOIN "admin_roles" r ON r.key = f.role_key
ON CONFLICT DO NOTHING;

-- Same reason: seed-roles.ts only writes default grants for roles it creates.
INSERT INTO "admin_role_permissions" ("role_id", "permission_key")
SELECT r.id, 'flow:webhook_trigger' FROM "admin_roles" r WHERE r.key = 'power_users'
ON CONFLICT DO NOTHING;
```

Column names (`admin_feature_flag_roles.flag_key`/`role_id` and
`admin_role_permissions.role_id`/`permission_key`, each unique on the pair)
and role keys (`SYSTEM_ROLE_KEYS`: `admins`, `power_users`) were checked
against `release/alpha-2`.

- **Fresh install.** Migrations run before `seedRoles`, so the backfill finds
  no roles and inserts nothing. `seedRoles` then scopes the flags from
  `POWER_USER_SCOPED_FLAGS` and `ADMIN_SCOPED_FLAGS`.
- **Upgraded install.** The roles already exist, so the backfill does the
  scoping.

**Data-impact:** every unique index is on a **new, empty** table, and the
`NOT NULL` column on `app_sessions` has a default. The file declares:
`-- data-impact: preserved — new tables are empty; app_sessions.origin defaults to 'manual' for existing rows`.

**Tests:**

- extend `seeded-feature-flags.test.ts` for the three keys;
- `migration-safety.test.ts` must pass;
- `seed-roles.test.ts` covers the new lists and the new Power Users grant;
- a migration-SQL test asserts the `flow:webhook_trigger` backfill exists.

## 8. Tests (write first)

**Domain (pure)**

- `readJsonPath`: nested, indexed, missing, and non-object paths.
- `evaluateWatchItems`:
  - each condition kind;
  - baseline (fires nothing);
  - fire-once;
  - edge-triggered `matches`;
  - per-poll cap;
  - `1` vs `"1"`;
  - items that disappear and return.
- `validateTriggerPayload`: coercion, required inputs, dropping undeclared
  keys.
- `deriveRunStatus`.
- `validateEventWatch`: interval ≥ 1, item ID path required with an items path,
  threshold 1–50.

**Application (doubles)**

- `PollDueWatches`:
  - success starts runs and saves state;
  - a failed run start leaves the item unfired;
  - a failure increments the counter and pauses at the threshold with one
    alert;
  - cap exceeded pauses without advancing state;
  - an unavailable run-as user pauses the watch.
- `StartUnattendedRun`: inactive user, unpublished flow, no access, success
  pinned to the version.
- `AdvanceUnattendedRun`:
  - chains AI task → email;
  - stops at conversational and approval nodes;
  - stops on a pending auto callback;
  - sets `run_error` and alerts;
  - 50-step cap.
- `RunAiTaskNode`: above threshold advances; below raises an approval with
  draft outputs; reject fails the run.
- `RunEmailNode`:
  - group expansion;
  - domain allow-list;
  - attachments;
  - one send per recipient;
  - audit without the body.
- Webhook use cases: token hash match, rotation invalidates, HMAC required,
  validation errors.
- Webhook permissions:
  - without `flow:webhook_trigger` → `FORBIDDEN`;
  - with it on a flow the user doesn't own → `FORBIDDEN`;
  - admin on any flow → allowed.
- `RunAiTaskNode` reviewer resolution: `run_owner`, `named_user`,
  `approver_source`.
- Driver with a flag off → `run_error.code = "feature_disabled"`; Retry after
  re-enabling resumes.
- `AutomationConfig` validation: hostnames only, no wildcards.
- `RetryFailedStep`.
- Alerts: idempotent per incident ID; a retry that fails again alerts again.

**Adapters**

- `FetchOutboundHttpClient`:
  - blocks `127.0.0.1`, `169.254.169.254`, `10/8` and IPv6 ULA;
  - allow-list override;
  - re-checks redirects;
  - timeout and size cap;
  - redaction.
- Drizzle repositories against the test DB: `claimDue` skip-locked with two
  concurrent claimers; secrets round-trip encrypted and are never in the read
  model.
- `EventWatchWorker`: tick never overlaps; registers its job.
- Nodemailer attachments.

**API**

- `triggers.test.ts`: 202, 401, 400, 404 and 429; HMAC; raw body.

**Web (component)**

- JSON tree picker selection.
- Condition builder per kind.
- Triggers tab token shown once.
- Badge hidden when the flag is off.

**E2E**

- Only if `docs/guides/e2e-test-policy.md` places admin watch creation in one
  of its six groups. Otherwise none.

## 9. Validation & done

- `./validate.sh` green after each sub-phase.
- **Manual smoke:**
  - point a watch at a local JSON fixture server (allow-listed host);
  - flip an item's status;
  - confirm one run, one email and the run history row;
  - break the URL → pause after 5 polls, one alert;
  - resume.
- **Version:** `VERSION` and root `package.json` move to `0.28.40` (applied by
  `/build`).

## 10. Exceptions, risks & forward-merge notes

- **Release-rule exception.** A new feature on `release/alpha-2`, at the
  requester's direction (2026-10-22). Record this in the implementation
  summary.
- **Versioning-rule exception, waived by the requester at `/doc-review`
  (2026-10-22).** A schema change shipped as a PATCH (`0.28.40`), because
  `0.29.x` would collide with `main`'s line (`0.40.x`). Doc-review check 5 is
  accepted as waived, not passed.
  Release notes **must** say "contains a database migration; run migrations
  before starting".
- **Forward-merge to `main`:**
  - Renumber the migration past `main`'s latest (`0056` at time of writing).
    Precedent: `0045_welcome_tour` → `0049_welcome_tour`.
  - Reconcile the `SecretCipher` extraction with `main`'s settings repository.
  - ADR numbers 063–065 are already clear of `main`.
- **SSRF:** ADR-063 §6. **Runaway firing:** baseline, fire-once and cap.
  **External email:** allow-list, audit, and the reviewer gate.
- **In-process driver:** a crash mid-run leaves the session active with its
  lease expiring, so the owner must resume it by hand. The sweeper is future
  work.

## 11. Build change summary (approved at `/build`, 2026-10-22)

The build runs in three sub-phases, in order:

- **A:** AI task and Email steps, plus the shared foundations (migrations,
  flags, permissions, `SecretCipher`).
- **B:** trigger inputs, the unattended driver, webhook start, and run history
  and alerts on the flow Triggers tab.
- **C:** Event Watch: the outbound HTTP client with its private-address guard,
  the poller worker, and the admin list, editor and run history with an
  incident badge.

Each sub-component writes its tests first and ends with a green
`./validate.sh`. The branch is `feature/unattended-automation/claude-rbrasier`,
cut from the docs branch on `release/alpha-2`. The PR targets
`release/alpha-2` (approved exception). Version `0.28.40` (PATCH, waived).

**E2E:** none. No part of the feature falls into the six groups of
`docs/guides/e2e-test-policy.md`. Coverage is at the domain, application and
api-route layers.

**Source issue:** rbrasier/wayfinder#334. Event Watch, item state and the Email
step answer its schedule, state and notify asks. MCP subscriptions and
streaming are not covered, so the PR says `Part of #334`.

**Build-time risk:** this sandbox has no live database. Repository SQL and the
migration are exercised by `validate.sh` §22 (schema vs migrations) and by CI.

### Decomposition (build order)

**Sub-phase A: foundations, AI task and Email**

| # | Sub-component |
|---|---|
| A1 | Domain node types: `flow-node.ts`, `approval.ts`, `notification-log.ts`, `permission.ts`, with tests |
| A2 | Domain session and settings: `session.ts` (origin, `runError`, `deriveRunStatus`), `runtime-config.ts` (`AutomationConfig`) |
| A3 | Persistence: schema changes, the generated migration, the custom seed migration, `seed-roles.ts`, plus seed, role and safety tests |
| A4 | `SecretCipher` extraction; email attachments (port and nodemailer) |
| A5 | `run-ai-task-node.ts` |
| A6 | `run-email-node.ts` |
| A7 | Approval decision for `ai_task` subjects |
| A8 | Web: AI task and Email step cards, flag gating, disabled state |
| A9 | Web: Automation settings card and runtime config getter |

**Sub-phase B: triggers, driver and webhook**

| # | Sub-component |
|---|---|
| B1 | Domain: `flow-trigger.ts`, `trigger_input` source, flow and snapshot inputs |
| B2 | Flow-trigger port and repository; session-repository additions |
| B3 | `start-unattended-run`, `advance-unattended-run`, `retry-failed-step` |
| B4 | Re-entry hooks in existing advance paths; `trigger_input` resolver |
| B5 | `notify-unattended-incident`, `list-trigger-runs` |
| B6 | `flow-trigger/*` use cases |
| B7 | API: `webhook-signature.ts`, `routes/triggers.ts`, wiring |
| B8 | Web: flow-trigger router, Triggers tab, "Trigger inputs" picker group |

**Sub-phase C: Event Watch**

| # | Sub-component |
|---|---|
| C1 | Domain: `event-watch.ts` pure functions |
| C2 | Outbound HTTP client port and adapter |
| C3 | Event-watch port and Drizzle repository |
| C4 | `poll-due-watches` |
| C5 | `event-watch/*` use cases |
| C6 | `event-watch-worker` plus wiring |
| C7 | Web: router, admin list with badge, sidebar item |
| C8 | Web: watch editor (JSON picker, condition builder, preview, mapping) and run history page |
