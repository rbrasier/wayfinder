# Phase — Approval Subject ("What Is Being Approved")

- **Status**: Awaiting review
- **Target version**: 2.11.0  (bump: MINOR — new feature, additive `app_flow_nodes.config` + `app_session_approvals.record_snapshot` jsonb; no migration)
- **PRD**: `docs/development/prd/approval-subject.prd.md`
- **ADRs**: ADR-040 (config mirrors `FieldValueSource`, resolve-once at gate, lock at decision, no migration)
- **Depends on**: approval step (ADR-018, `Approval` entity, `node-config-modal-approval.tsx`), `FieldValueSource` / `PriorStepField` (`packages/domain/src/entities/field-value-source.ts`), email transport (ADR-023), `recordSnapshot` on `app_session_approvals`

## 1. Problem

An approval node configures *who* approves but never *what*. The approver sees no
explicit subject, and the `Approval` record does not pin the subject at decision
time. Add a config-time "What is being approved" (prior step, default last
completed, or a custom AI-interpreted instruction), show it to operator and
approver, and lock it into the record. See the PRD.

## 2. Goals

- `ApprovalNodeConfig.approvalSubject`: `{ kind: "step"; nodeId }` (default last
  completed) | `{ kind: "custom"; instruction }`.
- Config UI: prior-step dropdown defaulting to the last completed step + custom
  free-text.
- Runtime resolves a human-readable statement (+ the step's output snapshot for the
  step case), shown at the gate and in the approver request/email.
- The resolved subject is locked into `recordSnapshot` at decision time and never
  recomputed.

## 3. Non-goals

Changes to approver resolution/delegation; new decision outcomes; migration;
multi-subject approvals; operator-typed subjects.

## 4. Approach

Bottom-up, test-first. Add `approvalSubject` to the config (reusing the
`FieldValueSource` shape). Resolve at approval-raise: step case reads the prior
step's `SessionStepOutput`; custom case makes one model call to summarise from
gathered info + instruction, cached on the pending approval. Lock the resolved
subject into the existing `record_snapshot` jsonb on decision. Surface it in the
gate UI and the email. No schema change.

## 5. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| domain | `packages/domain/src/entities/flow-node.ts` | add `ApprovalNodeConfig.approvalSubject` (step \| custom); absent ⇒ step/last-completed |
| domain | `packages/domain/src/entities/approval.ts` | `recordSnapshot` carries `subjectDescription` (+ `subjectNodeId`); document the shape (no new column) |
| application | approval-raise use-case (`packages/application/src/use-cases/session/…` approval) | resolve subject: step snapshot or one-call custom summary; attach to the pending approval |
| application | approval-decision use-case | freeze resolved subject into `recordSnapshot` on decide |
| adapters | approval repository | persist/read the extended snapshot (jsonb — no column) |
| web | `apps/web/src/components/canvas/node-config-modal-approval.tsx` | "What is being approved": prior-step dropdown (default last completed) + custom free-text |
| web | `apps/web/src/components/canvas/approval-node.tsx` | reflect configured subject |
| web | approval gate UI + email template (ADR-023) | display the subject statement |

## 6. Implementation steps (test-first per CLAUDE.md)

1. **Domain — config + snapshot shape.** Add `approvalSubject`; document the
   `recordSnapshot` subject keys. Tests: default resolves to `{ kind: "step" }`
   against last completed; back-compat for absent config.
2. **Application — resolve at gate.** Implement subject resolution: step reads the
   referenced `SessionStepOutput` and builds a statement + snapshot; custom makes
   one model call and caches the summary on the pending approval. Tests: step
   statement + snapshot; custom summary from gathered info; custom cached (no
   recompute per read); last-completed selection on a branch.
3. **Application — lock on decision.** Freeze the resolved subject into
   `recordSnapshot` on decide; assert it does not change if the session continues.
4. **Adapters — repository.** Persist/read the extended snapshot via jsonb; repo
   test round-trips subject keys with no schema change.
5. **Web — config UI.** Prior-step dropdown defaulting to last completed + custom
   free-text in the approval modal; reflect on the node. Tests cover both kinds and
   the default.
6. **Web — gate + email.** Show "You are requesting approval of: …" at the gate and
   in the approver request/email.
7. **Version + validate.** Bump `VERSION` and `package.json#version` to `2.11.0`.
   Run `./validate.sh`; fix all failures. Move this phase doc to
   `docs/development/implemented/alpha-2/v2.11.0/` with a summary.

## 7. Acceptance criteria

Mirror PRD §10:

- [ ] Config offers a prior-step dropdown defaulting to the last completed step,
      plus a custom free-text option.
- [ ] Step case resolves a readable statement and captures the step's snapshot.
- [ ] Custom case produces an AI subject statement from gathered info + instruction.
- [ ] Subject is shown to the operator at the gate and to the approver in the
      request and email.
- [ ] Resolved subject is locked into `recordSnapshot` at decision time and never
      changes afterwards.
- [ ] Pre-feature approvals (no `approvalSubject`) still work, defaulting to the
      last completed step.
- [ ] Architecture intact (Result at boundaries); no migration.
- [ ] `VERSION` = `package.json#version` = `2.11.0`; `./validate.sh` passes.

## 8. Risks / open questions

- Cache the custom summary on the pending approval so it is not recomputed per
  render.
- Precise "last completed step" on a branching flow — the step whose output most
  recently preceded the approval on the taken path.
- Show the field snapshot inline at the gate or only the statement (leaning
  statement + expandable snapshot).
