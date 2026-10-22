# Implementation Summary — Unattended Automation (v0.28.41)

- **Version**: 0.28.41 (bump: **PATCH, by explicit requester exception**. It
  would otherwise be MINOR: there are schema changes and new features. 0.28.40
  went to the vite advisory fix, rbrasier/wayfinder#344.)
- **Base branch**: `release/alpha-2`, by explicit requester exception to "new
  features land on `main`".
- **PRD**: `docs/development/prd/unattended-automation.prd.md`
- **ADRs**: 063 (Event Watch), 064 (flow triggers and webhook), 065 (unattended
  runs, AI task and Email steps, alerts)
- **Phase**: `unattended-automation.phase.md` (this folder)
- **Issue**: rbrasier/wayfinder#334 (part of)

## What was built

Flows can now run with nobody at the keyboard.

- **Event Watch** (Admin → Event Watch, admins only, `event_watch` flag). A
  watch polls one JSON API on an interval, judges each item against a condition
  (changes to a value, matches a value, a new item, or any change) and starts
  one run of a flow per item that fires. The connection (URL, method, body,
  none/bearer/API key, the secret encrypted at rest) lives on the watch itself.
  The editor's **Test** fetches a sample, shown as a tree; admins click paths
  for the list of items, the item ID, the condition field and each of the
  flow's inputs, then **Would fire now?** previews which items would start a
  run. The list shows each watch's health, its last run and a link to its run
  history, where failed runs can be retried. The menu item carries a badge:
  paused watches plus watch runs stopped on an error.
- **Safety rules on a watch.** The first check after creating it, or after
  editing what it reads, records a baseline and starts nothing. Fire-once per
  item is the default. If more items match in one check than the per-check cap,
  nothing starts, nothing is recorded, and the watch pauses. After N failed
  checks in a row (default 5) the watch pauses. A watch also pauses if its
  run-as person or its flow is no longer available. Each pause alerts the run
  owner once. Resume does not re-baseline.
- **Start a flow by webhook** (flow editor → Triggers, `flow:webhook_trigger`
  permission, granted to Power Users). There is one secret URL per flow. The
  token is shown once and can be rotated. An HMAC signature can be required.
  Calls are rate limited per flow. The flow declares its **trigger inputs**,
  which callers (and watches) supply, and steps read them as a new
  "Trigger input" field source.
- **AI task step** (`ai_task_node` flag). It runs an instruction over chosen
  prior-step fields and returns structured fields with a confidence. Below the
  threshold, it raises an approval: the reviewer (the run owner, an approver
  source or a named person) can edit the draft before it moves on.
- **Email step** (`email_node` flag). It emails people, groups or fixed
  addresses on an allowed domain, with a templated subject and body, and can
  attach documents from earlier steps.
- **Unattended run driver.** It walks AI task, Email, automated and MCP steps
  by itself (at most 50 per call, one turn lease at a time). It parks at a
  person's step and tells the owner. On failure it records the error on the
  session and alerts the owner. A scheduler-tick sweep resumes runs stalled on
  a step the driver can run alone.
- **Admin → Settings → Automation card**: the watch allowed hosts (private
  addresses that pass the SSRF guard) and the email allowed domains.

## Key decisions / notes

- Webhook intake, the run driver and polling all live in the **web app**,
  where the AI and email machinery is wired. The API keeps its role as the
  scheduler heartbeat; polling and the stalled-run sweep ride its existing
  tick (`/api/internal/scheduler/tick`, 20 watches and 20 stalled runs per
  tick).
- Run status (running, waiting on a person, failed, completed…) is derived on
  read from the session, never stored.
- Secrets (watch credentials, webhook HMAC secrets) are encrypted with the
  existing settings encryption service behind a `SecretCipher` interface.
  Webhook tokens are stored only as a SHA-256 hash.
- Outbound calls go through `FetchOutboundHttpClient`. It blocks private,
  loopback, link-local, CGNAT and ULA addresses unless they are allow-listed,
  re-checks every redirect (3 at most), and enforces a 15 s timeout, a 5 MB
  cap and a JSON body.

## Migrations

- `0046_unattended_automation.sql` — new `app_flow_triggers`,
  `admin_event_watches` and `admin_event_watch_item_states`; new columns on
  `app_sessions` (`origin`, `trigger_source_id`, `trigger_payload`,
  `run_error`) and `app_flows` (`trigger_inputs`); widened node-type enums.
  `-- data-impact: preserved — the three new tables are created empty, so their unique constraints cannot meet an existing row; app_sessions.origin defaults to 'manual', which is how every existing session was started, and the other added columns are nullable`
- `0047_seed_unattended_automation.sql` — the three flags, their role scoping
  on upgraded installs, and `flow:webhook_trigger` for Power Users.
  `-- data-impact: preserved — inserts only; ON CONFLICT DO NOTHING leaves any flag row, scoping or grant an admin already set untouched`

## Files created (main)

- **Domain**: `entities/{automation-steps,automation-config,event-watch,flow-trigger,unattended-run}.ts`;
  ports `{event-watch-repository,flow-trigger-repository,outbound-http-client,unattended-run-repository}.ts`.
- **Application**: `use-cases/automation/*` (start, advance, retry, resume
  stalled, list trigger runs, webhook trigger management, start from webhook,
  set trigger inputs, unattended step runner);
  `use-cases/event-watch/*` (save, lifecycle, test and preview, list and badge
  count, poll due watches, shared request builder and sample truncation);
  `session/run-ai-task-node.ts`, `session/run-email-node.ts`;
  `notifications/{notify-unattended-incident,unattended-templates}.ts`;
  `services/resolve-session-graph.ts`.
- **Adapters**: `repositories/drizzle-{event-watch,flow-trigger,unattended-run}-repository.ts`,
  `http/fetch-outbound-http-client.ts`, `automation/webhook-crypto.ts`, the two
  migrations.
- **Web**: `app/(admin)/admin/event-watches/**` (list, new, edit, run history),
  `components/event-watch/*` (editor, connection fields, JSON field picker,
  condition builder, model), `components/automation/*` (Triggers dialog,
  webhook panel, trigger inputs editor, run history list),
  `components/canvas/{ai-task-config-form,email-config-form,automation-step-modal,automation-step-model,automation-node,person-picker}.tsx`,
  `components/settings/automation-card.tsx`, `app/api/triggers/[flowId]/route.ts`,
  `lib/automation/*`, `lib/chat/prompt-context.ts`, `lib/container-automation.ts`,
  routers `automation.ts`, `event-watch.ts`, `settings-automation.ts`,
  `automation-step-guard.ts`.

## Files modified (selected)

- Domain: `flow-node.ts` (`ai_task`, `email` node types and configs),
  `session.ts` (origin, trigger payload, run error), `approval.ts` (`run_owner`
  and `named_user` approver sources), `notification-log.ts`, `permission.ts`,
  `field-value-source.ts` (`trigger_input`), `flow.ts`, `flow-version.ts`.
- Application: `start-session.ts`, `resolve-field-values.ts`,
  `schedule-node-event.ts`, `approver-edit-subject-fields.ts` (approvers can
  edit a structured record), `get-feature-flag.ts` (new flags default on).
- Adapters: schema files, `seed-roles.ts`, `runtime-config-store.ts`,
  `nodemailer-email-sender.ts` (attachments), session and flow repositories.
- Web: `container.ts`, `sidebar.tsx`, the flow config page and canvas node
  files, `routers/{approval,flow,settings}.ts`, the scheduler tick route,
  `scheduled-session-fire-handler.ts`.
- API: `routes/webhooks.ts` (shares the adapters' HMAC verifier).

## Tests

52 new test files across domain (evaluation, validation, templating, run
status), application (every use case above, with in-memory doubles), adapters
(SSRF guard and redirects, repository SQL and mapping, webhook crypto,
nodemailer attachments, migration SQL), and web (routers, the scheduler tick,
the trigger route, the editor and sidebar models).

**E2E** (`docs/guides/e2e-test-policy.md`):

- `apps/web/e2e/unattended-automation.spec.ts` covers two groups.
  - **Smoke (6):** a webhook call goes through the real stack. A wrong token
    gets 401. The right token gets 202, and the run appears in the flow's
    Triggers history as "Waiting on a person".
  - **Navigation state across a page load (4):** a watch built in the editor
    survives a reload. The editor uses Test, picks from the sample, previews
    and saves; after the reload the token is kept but never sent back.
- `accessibility.spec.ts` (group 5) audits `/admin/event-watches` and
  `/admin/event-watches/new` too.
- Supporting changes:
  - The seed adds a published automation flow with one trigger input and
    allow-lists the app's host for watches (`lib/e2e-fixtures-automation.ts`).
  - A test-only `/api/test/watch-source` stands in for the external API. It
    only exists when `TEST_AUTH_BYPASS=true`.
  - Teardown deletes watches before flows.
  - The new routes are added to `warm-routes.txt`.
- All of these passed locally against the full stack.

## Known limitations

- Polling cadence is the scheduler's 60 s tick, so a 1-minute watch checks
  roughly every minute, not exactly.
- The webhook rate limiter is in memory, per web instance.
- The SSRF guard checks addresses at resolution time; DNS rebinding between the
  check and the connection is a residual risk (ADR-063 §6).
- The run-as check confirms the account exists and the flow is published. There
  is no account deactivation to check, and flow visibility is not enforced
  when an unattended run starts.
- Retrying a failed Email step re-sends to every recipient.
- The web app has no component-test harness, so the editor's "component" tests
  are tests of the pure model behind it (tree rows, pick rules, condition
  switching, form round-trip, badge visibility).

## Deviations from the approved change summary

- **Webhook intake in the web app**, not `apps/api`; **polling and the
  stalled-run sweep on the existing scheduler tick**, not a new
  `EventWatchWorker` (ADR-063 §5 updated to say so).
- **Settings encryption reused** through a `SecretCipher` interface rather than
  extracting a new cipher.
- **Triggers is a dialog** opened from the flow editor header, not a tab.
- **No group reviewer** for AI task steps (dropped at `/doc-review`).
- **Rejecting an AI task review** follows the standard approval behaviour.
- **Email bodies are escaped plain text** turned into HTML paragraphs; there is
  no markdown rendering.
- **Branches park the run**: at a fork the driver waits for confirmation,
  through `awaitingConfirmationNodeId`.
- **A webhook's inputs** may be the body's `inputs` object or a plain object
  body.
- **Approvers can edit structured records**, which also benefits every
  structured approval, not only AI task reviews.
- **Prompt context helpers** were extracted to `lib/chat/prompt-context.ts` so
  the scheduler and the run driver share them.
- **Version 0.28.41**, not 0.28.40, because the vite fix took 0.28.40.
