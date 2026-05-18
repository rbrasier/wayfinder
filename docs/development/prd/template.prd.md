# PRD — &lt;Feature Name&gt;

> Copy this file to `docs/development/prd/<short-slug>.prd.md`, fill it in,
> then route to the Documentation Review skill before any code is written.

- **Status**: Draft / In Review / Accepted / Superseded
- **Date**: YYYY-MM-DD
- **Author**: <name>
- **Target version**: 0.x.0  (bump: MAJOR / MINOR / PATCH — see `docs/guides/versioning.md`)

## 1. Problem

What hurts today, and for whom? Two or three sentences. Avoid solutioning here.

## 2. Users / Personas

- **<persona>** — what they need this for. Repeat per persona.

## 3. Goals

- Bullet list. Each goal is observable — "the user can do X" or
  "Y latency is below Z".

## 4. Non-goals

- What this PRD explicitly does **not** do. Stops scope creep early.

## 5. Key entities

| Entity | Lives in        | New / existing | Notes |
| ------ | --------------- | -------------- | ----- |
| Foo    | `packages/domain/src/entities/foo.ts` | new | …     |

## 6. User stories

1. As a <persona>, I can <action>, so that <outcome>.
2. …

## 7. Pages / surfaces affected

- `/route/path` — what changes
- `apps/api` `/v1/...` — what changes
- tRPC: `<router>.<procedure>` — added / changed

## 8. Database changes

| Table             | Change                       | Prefix valid?           |
| ----------------- | ---------------------------- | ----------------------- |
| `app_<thing>`     | NEW                          | yes (app_)              |
| `core_users`      | add column `<col> text`      | n/a                     |

If no changes, write "None".

## 9. Architectural decisions

- Link to ADRs that this PRD assumes or introduces.
- New ADRs needed? List them.

## 10. Acceptance criteria

- Checklist — used by Documentation Review and as the test plan during Build.
  Each item must be testable.

## 11. Out of scope / future work

Capture obvious follow-ups here so they aren't forgotten — but explicitly
NOT in this PRD.

## 12. Risks / open questions

- …
