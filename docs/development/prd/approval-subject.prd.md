# PRD — Approval Subject ("What Is Being Approved")

- **Status**: Draft
- **Date**: 2026-07-19
- **Author**: rbrasier
- **Target version**: 2.11.0  (bump: MINOR — new feature, additive `app_flow_nodes.config` + `app_session_approvals.record_snapshot` jsonb; no migration. See `docs/guides/versioning.md`.)

## 1. Problem

An approval node configures *who* approves (`approverSource`) but never states
*what* is being approved. The approver sees a request with no explicit subject,
and the stored `Approval` row does not pin the subject as it stood at the moment
of decision. For a governance feature whose whole value is an auditable decision
trail, "approved — but approving what, exactly?" is a real gap.

## 2. Users / Personas

- **Flow owner** — configures the approval step and wants to name what the
  approver is signing off (the output of a prior step, or a described subject).
- **Operator** — reaches the approval gate and sees a clear statement of the
  subject before it goes to the approver.
- **Approver** — decides against an explicit, unambiguous subject.
- **Auditor** — reads back exactly what was approved, as it stood at decision time.

## 3. Goals

- The approval node config gains a **"What is being approved"** control:
  - a **dropdown of prior steps** (defaulting to the **last completed step**), or
  - a **custom** free-text instruction the AI interprets from the information
    gathered so far to produce a subject statement.
- At runtime the subject **resolves** to two things:
  - a **human-readable statement** shown to the operator at the gate and to the
    approver in the request/email, and
  - the referenced step's **output snapshot** (for the step case).
- The resolved subject — including the AI's summary for the custom case — is
  **locked at decision time** into the approval's `recordSnapshot`, so the record
  is immutable and auditable and never drifts if the session continues.

## 4. Non-goals

- No change to approver **resolution** (`approverSource`, delegation) — this PRD is
  only about the subject.
- No new decision outcomes (`approved` / `rejected` / `changes_requested`
  unchanged).
- No database migration — config and snapshot ride existing jsonb.
- No multi-subject approvals (one subject per approval node).

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
| ------ | -------- | -------------- | ----- |
| `ApprovalNodeConfig.approvalSubject` | `packages/domain/src/entities/flow-node.ts` | existing (add field) | `{ kind: "step"; nodeId }` (default: last completed) \| `{ kind: "custom"; instruction }`. Mirrors the `FieldValueSource` shape. |
| `PriorStepField` / prior-step resolution | `packages/domain/src/entities/field-value-source.ts` | existing (reuse) | supplies the config-time list of prior steps to choose from. |
| `Approval.recordSnapshot` | `packages/domain/src/entities/approval.ts` | existing (reuse) | now also carries `subjectDescription` (+ `subjectNodeId` for the step case), locked at decision time. |

## 6. User stories

1. As a **flow owner**, I can choose which prior step's output the approval is
   against, defaulting to the last completed step.
2. As a **flow owner**, I can instead type a custom instruction and have the AI
   describe the subject from what the session has gathered.
3. As an **operator**, I see a clear "You are requesting approval of: …" statement
   at the gate before sending.
4. As an **approver**, the request and email state exactly what I am approving.
5. As an **auditor**, the approval record shows the subject as it stood when the
   decision was made, and it never changes afterwards.

## 7. Pages / surfaces affected

- `apps/web/src/components/canvas/node-config-modal-approval.tsx` — the "What is
  being approved" selector (prior-step dropdown defaulting to last completed +
  custom free-text).
- Approval-raise application use-case — resolve the subject (step snapshot or AI
  summary), attach to the approval, snapshot at decision.
- Approval gate UI + approval email transport (ADR-023) — display the subject.
- `apps/web/src/components/canvas/approval-node.tsx` — reflect configured subject.

## 8. Database changes

None. `approvalSubject` rides `app_flow_nodes.config`; the locked subject rides the
existing `app_session_approvals.record_snapshot` jsonb.

| Table | Change | Prefix valid? |
| ----- | ------ | ------------- |
| `app_flow_nodes` | none (jsonb `config` gains `approvalSubject`) | n/a |
| `app_session_approvals` | none (jsonb `record_snapshot` gains `subjectDescription` / `subjectNodeId`) | n/a |

## 9. Architectural decisions

- **New:** ADR-040 — Approval subject resolution and decision-time snapshot.
- **Assumes:** ADR-018 (approval step & approver resolution), ADR-023 (email
  notification transport), the `FieldValueSource` `step_field` precedent.

## 10. Acceptance criteria

- [ ] Approval node config offers a prior-step dropdown defaulting to the last
      completed step, plus a custom free-text option.
- [ ] Step case: the subject resolves to a readable statement and captures the
      referenced step's output snapshot.
- [ ] Custom case: the AI produces a subject statement from gathered information +
      the instruction.
- [ ] The subject statement is shown to the operator at the gate and to the
      approver in the request and email.
- [ ] The resolved subject (incl. the AI summary) is locked at decision time into
      `recordSnapshot` and does not change if the session continues.
- [ ] An approval created before this feature (no `approvalSubject`) still works,
      defaulting to the last completed step.
- [ ] `VERSION` = `package.json#version` = `2.11.0`; `./validate.sh` passes.

## 11. Out of scope / future work

- Multi-subject / bundled approvals.
- Approver-side editing of the subject.

## 12. Risks / open questions

- Custom-case AI summary cost — one model call at gate time; confirm caching so it
  is not recomputed on every render.
- "Last completed step" resolution on a branching flow — define it as the step
  whose output most recently preceded the approval node on the taken path.
- Whether to also show the step's field snapshot inline at the gate, or just the
  statement (leaning: statement + expandable snapshot).
