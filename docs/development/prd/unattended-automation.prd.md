# PRD — Unattended Automation (Event Watch, Webhook Start, AI Task & Email Steps)

- **Status**: Draft — awaiting `/doc-review`
- **Date**: 2026-10-22
- **Author**: rbrasier
- **Target version**: 0.28.41 (bump: **PATCH, by explicit exception** — see §12)
- **Base branch**: `release/alpha-2` (**by explicit exception** — see §12)
- **Phase doc**: `docs/development/implemented/alpha-2/v0.28.41/unattended-automation.phase.md`
- **ADRs**: ADR-063, ADR-064, ADR-065

## 1. Problem

Every Wayfinder session today starts because a person clicked **Start** and
advances because a person typed. Event-driven work, the motivating case being
Senate Estimates, does not fit that model. When a hearing goes from live to
finished, someone has to notice. They then fetch the transcript, run a
summarisation flow by hand and email the result around. The noticing and
kicking-off is pure toil, it is late whenever nobody is watching, and none of it
is governed or audited.

## 2. Users / Personas

- **Administrator**: sets up Event Watches against external APIs, holds the
  API tokens, and chooses which flow a watch starts and as whom. Watches every
  watch's health.
- **Power User (flow author)**: builds flows that can run unattended using the
  new **AI task** and **Email** steps. Can turn on the **webhook** of a flow
  they own so other systems start it. This needs the new
  `flow:webhook_trigger` permission, which Power Users hold by default.
- **Run owner** (the watch or webhook's "run as" user): owns the sessions that
  unattended runs create. Is alerted when a run fails or needs a person.
- **Reviewer / approver**: picks up a low-confidence AI task result, or a
  human step, that an unattended run handed off.
- **External system** (e.g. a parliamentary hearings API, Power Automate, a
  script): is polled by a watch, or calls a flow's webhook.

## 3. Goals

- An admin can point a watch at any JSON API and, without code, pick fields
  from a live sample response. A flow run starts for each item that meets a
  stated condition, for example `status` going from `live` to `finished`.
- An outside system can start a flow by calling a per-flow secure web address,
  passing validated inputs such as `hearingId`.
- A flow can run an AI instruction with no person in the loop. Results below a
  confidence threshold go to a reviewer instead of flowing on.
- A flow can email its results, with the summary in the body and optionally
  generated documents attached, to users, groups and shared inboxes.
- Every unattended run has a named owner, is visible from the watch (or flow)
  that started it, and alerts its owner by email when it fails, waits on a
  person, or its watch pauses.
- API secrets are encrypted at rest and never returned to the browser.
- The three capabilities are feature-flagged (on by default) and role-scoped:
  Event Watch to **Admins**; AI task and Email steps to **Power Users**.

## 4. Non-goals

- Shared, reusable "Connections". Each watch carries its own one connection
  (ADR-063 §1).
- A standalone Run Monitor page. Run history lives on the watch list and on
  the flow's Triggers tab.
- OpenAPI/Swagger import, Basic auth, and OAuth2 client credentials.
- Non-JSON APIs (XML, RSS), push/streaming subscriptions, and polling more
  often than once a minute.
- Email recipients resolved from flow data (e.g. an address in a prior step's
  output).
- Slack, Teams or other alert channels.
- Using a watch's connection from inside a flow step ("data steps").

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
| ------ | -------- | -------------- | ----- |
| `EventWatch` | `packages/domain/src/entities/event-watch.ts` | new | Polling rule with its embedded connection (URL, auth, encrypted secret) |
| `WatchCondition` | `packages/domain/src/entities/event-watch.ts` | new | `transition` / `matches` / `new_item` / `changed` |
| `WatchItemState` | `packages/domain/src/entities/event-watch.ts` | new | Last-seen values and fired marker per (watch, item ID) |
| `FlowTrigger` | `packages/domain/src/entities/flow-trigger.ts` | new | Per-flow webhook: token hash, optional HMAC secret, run-as user |
| `TriggerInput` | `packages/domain/src/entities/flow-trigger.ts` | new | Named, typed input a flow declares; versioned with the flow |
| `FieldValueSource` | `packages/domain/src/entities/field-value-source.ts` | existing | Gains `{ kind: "trigger_input"; inputKey }` |
| `FlowNodeType` | `packages/domain/src/entities/flow-node.ts` | existing | Gains `"ai_task"` and `"email"` |
| `AiTaskNodeConfig` / `EmailNodeConfig` | `packages/domain/src/entities/flow-node.ts` | new | Step configs |
| `Session` | `packages/domain/src/entities/session.ts` | existing | Gains `origin`, `triggerSourceId`, `triggerPayload`, `runError` |
| `NotificationTrigger` | `packages/domain/src/entities/notification-log.ts` | existing | Gains `unattended_run_failed`, `unattended_awaiting_person`, `watch_paused` |

## 6. User stories

1. As an administrator, I open **Admin → Event Watch**, enter an API URL and
   token, and click **Test**. I see the JSON response as a tree and pick the
   list of hearings, the hearing ID and the `status` field.
2. As an administrator, I set the condition "`status` changes from `live` to
   `finished`", the interval (every 2 minutes), the flow to start, how hearing
   fields map to the flow's inputs, and whose name the run is in.
3. As an administrator, I see each watch's status, last poll and **last run**.
   I click **View run history** to see every run the watch started and open any
   of them.
4. As an administrator, when a watch's API keeps failing, the watch pauses
   itself and the run owner gets one email. I fix the token and click
   **Resume**.
5. As a Power User, I turn on **Start via webhook** for my flow, declare an
   input `hearingId`, copy the URL and token, and give them to the team that
   runs the external system.
6. As a Power User, I add an **AI task** step ("Summarise this transcript in
   one page for the Minister's office") and set a confidence threshold and a
   reviewer.
7. As a reviewer, when an AI task result falls below its threshold, I am
   notified. I accept, edit or reject the result, and the run continues.
8. As a Power User, I add an **Email** step that sends the summary in the body,
   with the generated brief attached, to the Estimates team inbox and the
   "Ministerial Liaison" group.
9. As a run owner, when an unattended run fails or reaches a step that needs a
   person, I get one email linking to the session.

## 7. Pages / surfaces affected

- `/admin/event-watches`: **new** list (new sidebar item under Admin, with an
  incident-count badge).
- `/admin/event-watches/new`, `/admin/event-watches/[id]`: **new** editor
  (connection, sample-and-pick, condition, mapping, run-as, failure threshold).
- `/admin/event-watches/[id]/runs`: **new** run history for one watch.
- Flow editor → **Triggers** tab: **new**. Holds the webhook toggle, URL, token
  rotate, HMAC, declared trigger inputs, and last run with run history.
- Flow canvas → node palette and step editor: **new** AI task and Email cards.
  Every existing `FieldValueSource` picker gains a "Trigger input" group.
- `apps/api` `POST /triggers/:flowId`: **new** inbound webhook.
- tRPC `eventWatch.*` (list, get, create, update, delete, test, preview, pause,
  resume, runs): **new**, admin-only.
- tRPC `flowTrigger.*` (get, setWebhookEnabled, rotateToken, setHmac,
  setInputs, runs): **new**.
- tRPC `session.retryFailedStep`: **new**.
- Admin → Settings: **new Automation card**. Holds `WATCH_ALLOWED_HOSTS`
  (private hosts a watch may call) and `EMAIL_ALLOWED_DOMAINS` (domains Email
  steps may send to).
- Admin → Roles: the new `flow:webhook_trigger` permission appears in the
  registry list. No UI change is needed.

## 8. Database changes

| Table | Change | Prefix valid? |
| ----- | ------ | ------------- |
| `admin_event_watches` | NEW. Watch plus embedded connection; `secret_encrypted` | yes (admin_) |
| `admin_event_watch_item_states` | NEW. Unique `(watch_id, item_id)` | yes (admin_) |
| `app_flow_triggers` | NEW. Unique `(flow_id, kind)`; `token_hash`, `hmac_secret_encrypted` | yes (app_) |
| `app_flows` | add `trigger_inputs jsonb` (nullable; absent = none) | n/a |
| `app_sessions` | add `origin text NOT NULL DEFAULT 'manual'`, `trigger_source_id uuid`, `trigger_payload jsonb`, `run_error jsonb` | n/a |
| `core_feature_flag` | seed `event_watch`, `ai_task_node`, `email_node` (enabled, 100%) | n/a |
| `admin_feature_flag_roles` | seed scoping for **existing** installs: `event_watch` → Admins; `ai_task_node`, `email_node` → Power Users | n/a |
| `admin_role_permissions` | grant `flow:webhook_trigger` to Power Users on **existing** installs | n/a |

All changes are additive, and existing rows carry across.

## 9. Architectural decisions

- **ADR-063 (new)**: Event Watch polling, an embedded per-watch connection,
  condition evaluation and item state.
- **ADR-064 (new)**: Flow triggers. Per-flow webhook security, declared
  trigger inputs and the `trigger_input` value source.
- **ADR-065 (new)**: Unattended runs. Run-as ownership, the AI task and Email
  steps, hand-off to people, failure state and alerting.
- Assumes:
  - ADR-015 (flow versioning): trigger inputs join the snapshot.
  - ADR-019 (durable scheduler worker): the watch poller runs on it.
  - ADR-021 (developer-owned permission registry).
  - ADR-018 (approver resolution): reused for AI task reviewers.
  - ADR-033 (audit log).
  - ADR-041 (DB-first runtime config and settings encryption).

## 10. Acceptance criteria

- [ ] An admin can create a watch, click **Test**, and pick the items path,
      item ID path and condition field from a tree of the live response,
      without typing a JSON path.
- [ ] The first successful poll of a new or edited watch starts **no** runs; it
      records the current state of every item.
- [ ] With condition `transition status live→finished`, an item observed as
      `live` then `finished` starts exactly one run. With "fire once per item"
      on, it never starts another for that item ID.
- [ ] `matches`, `new_item` and `changed` conditions each start runs exactly
      as specified in ADR-063 §4, covered by pure unit tests.
- [ ] A poll that matches more than the per-poll cap (default 20) starts none,
      pauses the watch, and alerts the run owner.
- [ ] After `failureThreshold` (default 5) consecutive poll failures, the watch
      is `paused` and exactly one `watch_paused` email is sent per pause.
- [ ] A watch's secret is never returned by any tRPC procedure and never
      written to logs, audit entries or `run_error`.
- [ ] Outbound requests to loopback, link-local (including `169.254.169.254`),
      and private ranges are refused unless the host is on the admin allow-list.
- [ ] `POST /triggers/:flowId` with a valid token and valid inputs returns
      `202` with the session ID. A bad token returns `401`; invalid inputs
      return `400` and start no run; a disabled or unpublished flow returns
      `404`. Excess calls are rate-limited (`429`).
- [ ] With HMAC enabled, a request without a valid `X-Wayfinder-Signature` is
      rejected `401` even with a valid token.
- [ ] A webhook token is shown exactly once. Rotating it invalidates the old
      one immediately.
- [ ] A user without `flow:webhook_trigger` cannot see the webhook panel, and
      their `flowTrigger.*` mutations return `FORBIDDEN`. A Power User can
      enable a webhook only on a flow they own. An admin can enable one on any
      flow. This holds on both fresh and upgraded installs.
- [ ] A step can bind a field to a trigger input. The value is the validated
      input from the starting watch or webhook.
- [ ] An AI task step at or above its threshold advances automatically. Below
      it, the run waits and the reviewer can accept, edit or reject. The
      reviewer is the run owner, an approval-style approver, or a named user;
      there is no group reviewer.
- [ ] An Email step sends to resolved user and group addresses and fixed
      addresses. External addresses outside a configured domain allow-list
      fail the step. Selected prior-step documents are attached.
- [ ] An unattended run that reaches a conversational or approval step waits,
      and the responsible person and run owner are notified once.
- [ ] A step failure stores `run_error` on the session, emails the run owner
      once, and the run can be retried from that step.
- [ ] The watch list shows last poll, last run and **View run history**. The
      flow Triggers tab shows the same for webhook runs.
- [ ] Disabling `event_watch` hides the Admin menu item and stops polling.
- [ ] Disabling `ai_task_node` or `email_node`:
      - removes the card from the palette;
      - shows "Disabled by administrator" on existing steps of that type;
      - fails a run reaching such a step with `run_error.code =
        "feature_disabled"`, with one alert.

      Re-enabling the flag and using **Retry** resumes the run.
- [ ] On an **upgraded** install the three flags are scoped to the right roles.
      On a fresh install they are too.

## 11. Out of scope / future work

- Shared Connections reused across watches and steps, and a "call API" data
  step.
- OAuth2 client credentials and Basic auth.
- OpenAPI-driven field picking.
- A cross-flow Run Monitor page, and Slack or Teams alerts.
- Email recipients taken from flow data.
- Group reviewers for AI task steps, where any group member claims and decides.
  This needs approvals to support more than one approver.
- Webhook replay protection beyond HMAC (timestamped signatures).

## 12. Risks / open questions

- **Release-rule override (accepted by requester).** `CLAUDE.md` routes new
  features to `main`. This ships on `release/alpha-2` at the requester's
  direction. Forward-merging to `main` will need migration renumbering:
  alpha-2's `0046+` collide with `main`'s. This is the same as the
  `0045_welcome_tour` → `0049_welcome_tour` precedent.
- **Versioning-rule override (accepted and waived by requester at
  `/doc-review`, 2026-10-22).** A schema change normally warrants MINOR.
  `0.29.0` would clash with `main`'s line (already `0.40.x`), so this ships as
  `0.28.41`. The version alone no longer signals
  that a migration is needed, and the release notes must say so.
- **SSRF.** Admin-entered URLs are fetched server-side. Mitigated by the
  private-range block, a `WATCH_ALLOWED_HOSTS` escape hatch, no redirects to
  blocked hosts, and response size and time limits.
- **Runaway firing.** Mitigated by the baseline first poll, fire-once-per-item,
  and the per-poll cap.
- **AI output emailed externally.** Mitigated by the domain allow-list, audit
  logging of every send, and the AI task reviewer gate placed before the
  Email step.
- **Open:** should a watch's run-as user need the flow's usual "may start"
  permission? This PRD says yes: the watch pauses if the user loses access.
