# ADR-065 — Unattended Runs: Ownership, AI Task and Email Steps, Hand-off, Alerts

- **Status**: Proposed (scoped by `unattended-automation.prd.md`)
- **Date**: 2026-10-22
- **Assumes**:
  - ADR-018 (approver resolution)
  - ADR-020 (step outputs)
  - ADR-021 (permission registry)
  - ADR-026 (operator confirmation)
  - ADR-033 (audit log)
  - ADR-063 and ADR-064
- **Numbering**: 065. See ADR-063.

## Context

Until now every session had a person driving it. A run started by a watch or
webhook has nobody at the keyboard. Five things need deciding:

1. who owns it;
2. how steps advance with no operator;
3. what the two new step types do;
4. what happens at a step that needs a person;
5. how failure is represented and how the owner is told.

## Decision

### 1. A named "run as" user owns every unattended run

Each watch and each webhook trigger stores `run_as_user_id`. It defaults to its
creator and can be changed only by an admin. `StartUnattendedRun` creates an
ordinary session with `userId = runAsUserId`. The session therefore appears in
that user's session list, uses that user's group visibility and budget, and
audit entries name them, with `origin` and the watch or trigger ID recorded
alongside.

Before starting, the use case checks the following:

- the user is active;
- the flow is published (it is pinned to the latest version, as
  `StartSession` does);
- the user may start the flow under existing visibility rules.

Failing a check returns a typed error. The watch then pauses (ADR-063 §7), and
the webhook returns `404`.

Rejected: always the flow owner, which breaks when the owner leaves. Rejected:
a system service account, because it bypasses group scoping and nobody is
accountable.

### 2. The unattended driver

`StartUnattendedRun` creates the session and then calls
`AdvanceUnattendedRun(sessionId)`. That loop executes the current node if the
node is **unattended-capable**, follows the edge, and repeats. It stops at a
node that needs a person, a pending async execution, or the end.

The unattended-capable nodes are:

| Node | Behaviour |
| ---- | --------- |
| `ai_task` | §3 |
| `email` | §4 |
| `auto` | Existing `RunAutoNode`. An n8n callback re-enters `AdvanceUnattendedRun` for `origin != 'manual'` sessions |
| `mcp` | Existing `RunMcpNode` |
| `scheduled` | Existing park and fire. On fire, the scheduler re-enters the driver for unattended sessions |

`AdvanceUnattendedRun` runs on the API process, outside any HTTP request. It is
started with `void` from the poller or route and holds the existing session
turn lease (`activeTurnId`), so a person opening the session cannot race it.
The loop is capped at 50 node executions per call; a cycle stops there and the
run fails with `loop_limit`.

Manual sessions also gain the two new node types: the existing runner calls the
same `RunAiTaskNode` and `RunEmailNode` when it reaches one. So the steps are
not exclusive to unattended runs.

### 3. AI task step (`ai_task`)

```ts
interface AiTaskNodeConfig {
  instruction: string;                       // e.g. "Summarise this transcript…"
  inputBindings: Record<string, FieldValueSource>; // named inputs to the prompt
  outputFields: TemplateField[];             // structured output; at least one
  confidenceThreshold: number;               // 0–100, default 80
  reviewer: AiTaskReviewer;
  skillRefs?: string[];                      // as conversational steps
}
type AiTaskReviewer =
  | { mode: "run_owner" }
  | { mode: "approver_source"; approverSource: ApproverSourceMode; roleHint?: string }
  | { mode: "user"; userId: string };
```

**There is no group reviewer mode.** `app_session_approvals` holds a single
`approver_user_id`, and group review (any member claims and decides) needs a
schema change and approver-queue changes. Both are out of scope here; group
review is noted as future work in the PRD.

The reviewer is stored on the approval row as follows:

- `run_owner` and `user` resolve to a concrete `approver_user_id` when the
  approval is raised.
- `approver_source` uses the existing ADR-018 resolver.
- The row's `approver_source` text column gains the values `run_owner` and
  `named_user`. It has no CHECK constraint, so this is a TypeScript-level
  change with no migration, the same as ADR-045 §4.

`RunAiTaskNode` resolves the bindings, which may include trigger inputs and
prior-step fields. It calls the language model with structured output for
`outputFields` plus a `confidence` (0–100) and a `rationale`, recording usage
like every other model call. Then:

- **Confidence ≥ threshold.** Outputs persist to `app_session_step_outputs`
  (ADR-020) and the run advances.
- **Confidence < threshold.** Outputs persist as a **draft**, and an
  `app_session_approvals` row is raised with the subject set to this step, the
  approver resolved from `reviewer`, and the instructions set to the rationale.
  The run waits. The reviewer uses the existing approval UI, extended for
  `ai_task` subjects so the fields can be edited before **Accept**. Accept
  commits the (edited) outputs and calls `AdvanceUnattendedRun`. **Reject**
  fails the run with `ai_task_rejected`.

This reuses the approvals table, queue and notifications rather than adding a
review inbox. Feature flag `ai_task_node`, scoped to **Power Users**.

### 4. Email step (`email`)

```ts
interface EmailNodeConfig {
  recipients: EmailRecipient[];   // at least one
  subjectTemplate: string;        // {{ input.x }} / {{ step.<nodeId>.<field> }}
  bodyTemplate: string;           // markdown → HTML + text
  attachStepIds: string[];        // prior steps whose generated docx/xlsx to attach
}
type EmailRecipient =
  | { kind: "user"; userId: string }
  | { kind: "group"; groupId: string }       // expanded to active members at send
  | { kind: "address"; email: string };      // fixed external / shared inbox
```

The templates use the same placeholder resolver as document generation, with
values HTML-escaped. `IEmailSender.SendEmailInput` gains optional
`attachments: { filename, contentType, content: Uint8Array }[]`, which nodemailer
supports natively. Attachments are read from object storage and capped at 20 MB
in total.

`address` recipients must match the `EMAIL_ALLOWED_DOMAINS` runtime setting
when it is set. If it is empty, any address is allowed. A disallowed address is
caught when the step is saved, and again at send time in case the setting
changed since.

There is one message per resolved recipient, not CC, so group members don't
see each other. Each send is audit-logged as `email_step.sent` with recipients
and subject, but not the body. An SMTP failure fails the run (§5). Feature flag
`email_node`, scoped to **Power Users**.

### 5. Hand-off to people, and failure

**Waiting on a person.** When the driver reaches a `conversational` or
`approval` node, it stops:

- **Approval node.** The approval is raised as today, and the approver is
  notified by the existing flow.
- **Conversational node.** The run owner gets an `unattended_awaiting_person`
  email linking to the session and simply continues it in the normal UI.

Once the person finishes the step, if the session's `origin` is not
`'manual'`, the existing advance path calls `AdvanceUnattendedRun` again, so
the remaining unattended steps run on their own.

**Failure.** A node that returns an error sets `app_sessions.run_error jsonb`
to `{ nodeId, code, message, at }` with secrets redacted. The session stays
`active`: there is no new `SessionStatus`, so every existing status consumer is
untouched. The owner is then alerted. `session.retryFailedStep` (run owner or
admin) clears `run_error` and re-enters the driver at `currentNodeId`.

**Derived run status**, used by run history and never stored:

| Status | Condition |
| ------ | --------- |
| `failed` | `run_error` is set |
| `waiting_on_person` | active and the current node is `conversational`, an `approval` node, or an `ai_task` with a pending review |
| `running` | active otherwise |
| `completed`, `cancelled`, `abandoned` | as `SessionStatus` |

### 6. Alerts: reuse the notification outbox

`NotificationTrigger` gains three values, and `app_notification_log`'s unique
`(trigger, resource_id, recipient_email)` makes each one send at most once:

| Trigger | `resource_id` | Effect |
| ------- | ------------- | ------ |
| `unattended_run_failed` | a fresh `run_error.incidentId` uuid per failure | A retry that fails again is a new incident and alerts again |
| `unattended_awaiting_person` | `"<sessionId>:<nodeId>"` (`resource_id` is `text`) | One per step reached |
| `watch_paused` | `admin_event_watches.pause_incident_id`, regenerated on each pause | One per pause, not per failed poll |

All three go to the run owner. The existing retry sweeper delivers them. No
`app_run_incidents` table is added.

`resource_type` gains `event_watch` for `watch_paused`. The session triggers
use `session`. Both `trigger` and `resource_type` are text columns with no
CHECK constraint, so the new values need no migration.

### 6a. A step whose feature flag is off

If a run reaches an `ai_task` or `email` node while `ai_task_node` or
`email_node` is disabled for the run owner, the step does not run. The driver
sets `run_error` to `{ code: "feature_disabled", message: "<Step type> steps
are disabled by an administrator" }` and the normal failure alert follows.
Re-enabling the flag and using **Retry** resumes the run. In the flow editor,
an existing step of a disabled type shows a "Disabled by administrator"
notice, and its card cannot be added from the palette.

**Badge.** The Event Watch menu item shows the number of watches that are
`paused`, plus the number of watch-originated sessions with `run_error` set.
It is computed by one count query, cached for 60 s.

### 7. Run history

`ListTriggerRuns({ sourceId, cursor })` pages `app_sessions` by
`trigger_source_id` (new index `(trigger_source_id, created_at desc)`) and
returns the derived status. The watch list's **Last run** is the first row of
the same query. The flow Triggers tab uses the same use case with the webhook
trigger's ID.

## Consequences

- No new session status and no new review inbox; approvals, the notification
  outbox and step outputs are all reused.
- Unattended runs consume the run-as user's budget, which surfaces cost in the
  right place.
- A run waiting on a person can wait indefinitely, as manual sessions do. The
  existing session-lifecycle controls apply.
- The driver is in-process. A crash mid-run leaves the session `active` and its
  lease expires. The next poll does **not** restart it. The owner can open the
  session, and a "resume stuck run" sweeper is noted as future work.
