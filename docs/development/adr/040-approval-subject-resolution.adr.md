# ADR-040 — Approval Subject Resolution & Decision-Time Snapshot

- **Status**: Proposed (scoped by `approval-subject.prd.md`)
- **Date**: 2026-07-19

## Context

An approval node (ADR-018) configures *who* approves via `approverSource` but
never captures *what* is being approved. The `Approval` entity already has
`recordSnapshot: Record<string, unknown> | null`
(`packages/domain/src/entities/approval.ts`) intended to freeze the record at
decision time, but nothing populates it with an explicit subject, and no config
names the subject. `approval-subject.prd.md` closes this: the author names the
subject, it is shown to operator and approver, and it is locked into the record.

The flow graph already knows how to reference a prior step's output: the `auto`
and `scheduled` nodes bind values through `FieldValueSource`
(`{ kind: "step_field"; nodeId; fieldKey }`) and surface prior steps via
`PriorStepField` (`packages/domain/src/entities/field-value-source.ts`). The
subject selector should reuse that shape, not invent a new one.

Constraints: additive/no migration (config in `app_flow_nodes.config` jsonb, the
locked subject in the existing `app_session_approvals.record_snapshot` jsonb);
the record must be **immutable once decided** for audit; back-compat for approvals
authored before this feature.

## Decision

### 1. Config mirrors `FieldValueSource`

Add `approvalSubject` to `ApprovalNodeConfig`:

```
approvalSubject:
  | { kind: "step"; nodeId: string }      // default: last completed step
  | { kind: "custom"; instruction: string }
```

The editor's prior-step dropdown is populated from `PriorStepField` and **defaults
to the last completed step**; "custom" reveals a free-text instruction. Absent
config (older nodes) resolves as `{ kind: "step" }` against the last completed
step, so nothing breaks.

### 2. Resolve once, at the gate

When the session raises the approval, the application use-case resolves the
subject:

- **step:** produce a human-readable statement from the referenced step's output
  and capture that step's field snapshot.
- **custom:** one model call summarises the subject from the information gathered
  so far plus the author's instruction.

The resolved `subjectDescription` (and `subjectNodeId` for the step case) is shown
to the operator at the gate and to the approver in the request and email
(ADR-023). The custom summary is computed **once** and cached on the pending
approval, not recomputed per render.

### 3. Lock at decision time

On decision, the resolved subject is frozen into `recordSnapshot`
(`{ subjectDescription, subjectNodeId?, … }`) alongside the existing snapshot
data. It is **never** recomputed afterwards, so a session that continues past the
approval cannot retroactively change what was approved. This is the audit
guarantee the feature exists for.

### 4. No migration

`approvalSubject` rides `app_flow_nodes.config`; the locked subject rides the
existing `record_snapshot` jsonb. No columns, no schema change.

## Alternatives considered

- **A new `FieldValueSource` variant / new columns for the subject.** Dedicated
  `subject_*` columns would be queryable but require a migration for data that is
  read as part of the approval record anyway; the existing `record_snapshot` jsonb
  is the right home. Rejected for now (revisit if subject reporting needs indexed
  columns).
- **Resolve the custom summary live (re-run per view).** Simpler state, but costs
  a model call on every render and — worse — lets the "subject" drift as the
  conversation continues, defeating the audit purpose. Rejected: resolve once,
  lock at decision.
- **Free-text subject typed by the operator at the gate.** Puts an authoring
  decision on the operator mid-session and yields inconsistent, ungoverned
  subjects. Rejected — the subject is authored at config time (step or instruction)
  and only *resolved* at runtime.
- **Default to the first step / no default.** The last completed step is the one
  the approver almost always means; defaulting there matches intent and keeps
  older nodes working.

## Consequences

**Positive**

- Every approval records an explicit, immutable statement of what was approved —
  the missing half of the audit trail.
- Reuses `FieldValueSource`/`PriorStepField` and `recordSnapshot`; no new plumbing,
  no migration.
- Back-compatible: pre-feature approvals default to the last completed step.

**Negative**

- The custom case adds one model call at gate time; must be cached on the pending
  approval to avoid recomputation.
- "Last completed step" needs a precise definition on branching flows (the step
  whose output most recently preceded the approval on the taken path).
- Subject data in jsonb is not directly indexable; acceptable until subject-level
  reporting is required.
