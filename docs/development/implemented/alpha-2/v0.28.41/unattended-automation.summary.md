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

## Amendment — editor and run-visibility polish (phase doc §12)

Built on the same branch after the review of the first screenshots.

- **Watch editor:** every path is a dropdown of the sample's fields with
  "Select manually…" near the top. The sample tree is a read-only preview.
- **Run history** (watch page and the flow's Triggers dialog): **Open chat**
  on every run.
- **Chat:**
  - While an AI task or Email step is current, a card sits above the
    composer ("AI task running…", "Waiting for <reviewer> to review…" or
    "Sending email…"). The composer is disabled and the session refetches
    every 3 s until the run moves on.
  - Each AI task result shows an **output card**: field count and
    confidence, with **View output** for every field and the rationale. Its
    message now carries the same `aiPayload` as other AI turns (rationale,
    confidence, captured values).
- **AI task editor:**
  - Inputs are dropdowns of earlier fields and trigger inputs (the
    scheduler's selector), named after the field and editable.
  - **Add skills** and **Add MCP** come from a shared `InstructionToolBar`,
    which the conversational step now uses too.
  - Output fields use the structured conversation's field editor: a label, a
    type dropdown, and a settings cog for required, limits and choices. This
    replaces typed `Label (type)` lines. At least one is required (already
    enforced; now said on-screen).
  - At run time the step's skill instructions and MCP tool results join the
    prompt (`lib/automation/ai-task-context.ts`).
- **Email editor:**
  - One recipient box suggests people and groups and accepts any typed
    address.
  - Subject and message have **Insert field**, offering trigger inputs and
    earlier fields.
  - The message is a Tiptap editor with a Rich text / Markdown toggle. It is
    rendered to HTML when sent by the domain's `renderMarkdownToHtml`, which
    shares the chat's markdown parser (moved from web to domain).
- **Automation settings:** a blank watch-hosts list allows any host except
  the cloud metadata range (ADR-063 §6 amended). The copy explains blank =
  any for both lists.

### Bugs found while capturing the screenshots

- **The AI task and Email step dialog** had no height limit, so on a short
  screen its Save button sat below the window and could not be reached. Its
  body now scrolls within 70% of the viewport, like the conversational
  step's.
- **The e2e scripted model** returned a schema default without running the
  schema, and did not understand `.transform`. An unscripted AI task
  therefore got an object for its confidence and failed with "Failed to
  create session message". Defaults now unwrap `ZodEffects` and run through
  the schema, as a provider's answer does, falling back to the raw default
  only when a strict schema rejects it. Production calls were never
  affected: the real provider always parses.

### Amendment deviations

- The official **`@tiptap/markdown`** extension was used instead of the
  community `tiptap-markdown`, pinned at 3.31.4 (newer releases were under
  two weeks old).
- **Native dropdowns** stay closed in screenshots; the e2e spec drives them by
  value.

### Amendment tests

- **Domain:** `markdown-html.test.ts`, `skill.test.ts`, and the moved
  `markdown.test.ts`.
- **Application:** `run-ai-task-node.test.ts` (rationale payload, extra
  context) and `run-email-node.test.ts` (HTML).
- **Adapters:** `fetch-outbound-http-client.test.ts` (blank list, metadata
  range) and `scripted-language-model.test.ts`.
- **Web:**
  - `watch-model.test.ts` (sample options, manual mode)
  - `automation-step-model.test.ts` (input rows, trigger-input tokens)
  - `recipient-suggestions.test.ts`
  - `automation-step-state.test.ts`
  - `ai-task-context.test.ts`
- **E2E:**
  - `unattended-automation.spec.ts` builds the watch with the dropdowns
    (group 4).
  - `accessibility.spec.ts` audits the Email step editor (group 5).
  - Both pass locally.

## Amendment 2 — readable field tags and a quieter AI task in the chat

Second round of review feedback on the screenshots. No schema change, and the
version stays 0.28.41.

**Readable field tags (screenshot 8).**
- Email placeholders read `{{ <step_key>.<field_key> }}`, e.g.
  `{{ summarise_the_hearing.summary }}`, instead of `{{ step.<uuid>.<key> }}`.
- The step key is the snake_cased step name, built by `deriveStepKeys`, the
  same helper approval records use (ADR-040 §5). A repeated name gets `_2`,
  `_3`…, and `input` stays reserved for trigger inputs.
- `flowStepKeys` (domain) settles repeats by node id. A published version's
  snapshot keeps neither creation times nor a stable node order, so node id is
  the only order the editor and the run both see the same way.
- `RunEmailNode` now takes the run's `nodes` (threaded through `StepContext`)
  so it can build the same keys. The old form never shipped, so nothing is
  migrated.

**The AI task in the chat (screenshot 12).**
- **Result:** an AI task's result is drawn as its output card alone, with no
  assistant bubble. The message is still stored, because it carries the record.
- **Info toggle:** a small ⓘ in the card's bottom-right reveals the confidence
  and rationale. **View output** now lists the fields only.
- **While pending:** while the step runs or waits on its reviewer, its card is
  hidden. In its place the feed ends on a spinner (the app's `Spinner`) and a
  line of muted text, with no box. The hourglass and the boxed card above the
  composer are gone; the composer is still disabled.
- `aiTaskResultView` (in `automation-step-state.ts`) decides message, card or
  hidden. `AutomationStepState` lost its unused `kind`.
- `automation-step-card.tsx` was renamed to `automation-step-pending.tsx`.

### Amendment 2 tests

- **Domain:**
  - `automation-steps.test.ts`: `flowStepKeys`, and placeholders by step key.
  - `approval-record.test.ts`: reserved keys.
- **Application:** `run-email-node.test.ts` resolves
  `{{ summarise_hearing.summary }}` from the run's nodes.
- **Web:**
  - `automation-step-model.test.ts`: tokens by step key.
  - `automation-step-state.test.ts`: `aiTaskResultView`.
- **E2E:** no new spec or test.
  - The existing smoke test in `unattended-automation.spec.ts` (group 6) is
    extended.
  - The seeded automation flow now runs an AI task step ("Summarise the
    hearing", threshold 50, below the scripted model's default of 75) before
    the person's step.
  - After the run parks, the test opens its chat from the run history, checks
    the output card, and opens the ⓘ to read "Confidence: 75%".

## Amendment 3 — local mocks for trying the features by hand

Requested so every new feature can be exercised locally without a real ParlView
or mail server. Both run on the shared mocks server (`./restart.sh --with-mocks`).
`restart.sh` prints the setup steps for each.

**ParlView hearing feed** (`mocks/parlview/`, mounted at `:4001/parlview`)

- **Data:** hearings are derived from the clock in 5-minute slots
  (`PARLVIEW_MOCK_PERIOD_SECONDS` to change). Each slot finishes one hearing
  and starts the next, so an Event Watch on `status equals finished` fires once
  per hearing.
- **Endpoints:**
  - `GET /parlview/api/hearings` lists the hearings under `data.hearings`,
    filtered with `?status=`.
  - `GET /parlview/api/hearings/:id` returns one hearing and its transcript.
  - `POST /parlview/api/advance` skips to the next change.
- **Webhook start:** `POST /parlview/api/webhook {url, token, hmacSecret?}`
  makes the mock call a flow's webhook as each hearing finishes, signed the way
  `verifyHmacSignature` expects. The first check is a baseline, like a watch,
  so turning it on never replays old hearings.
- **AI task:** the mock MCP server (`:4001/mcp`) gains `parlview_list_hearings`
  and `parlview_get_transcript`, over the same clock. An AI task started for a
  hearing can read its transcript.
- **Shape:** ParlViewMCP was not reachable from this session, so the feed's
  shape is a stand-in, kept in `hearings.mjs` (`toHearing`) so it is easy to
  align with the real one.

**SMTP mail catcher** (`mocks/smtp/`)

- **Server:** speaks enough SMTP for nodemailer on `MOCKS_SMTP_PORT` (default
  2525): AUTH PLAIN/LOGIN with any credentials, MAIL, RCPT and DATA. It refuses
  STARTTLS.
- **Output:** each message is printed to the mocks console (recipients,
  subject, attachments and text body) and kept at `:4001/smtp/messages`, with
  `/:id` for the raw source and `DELETE` to clear.
- **Setup:** point Admin → Settings → Email at host `localhost`, port `2525`,
  TLS off, any username and password.

**Tests:** the `mocks/` vitest suite, 151 tests:
- `hearings`, `api`, `webhook` and `tools` tests under `parlview/`
- `message`, `inbox`, and `server` (a real socket conversation) under `smtp/`

**Checked live:** a nodemailer send with HTML and an attachment was caught and
printed. An advance delivered a signed webhook call. An MCP client listed the
hearings and read the finished hearing's transcript.
