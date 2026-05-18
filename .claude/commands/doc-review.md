# /doc-review — Documentation Review

Use this skill when the user asks to review, check, or validate docs before
building, or when a phase doc exists in `to-be-implemented/` and the user
says "let's build this."

---

## Workflow

1. Read all referenced PRD, ADR, and phase documents in full.
2. Check each item below and output `PASS`, `WARN`, or `FAIL` with a reason:

### Checks

| # | Check | Fail condition |
|---|-------|----------------|
| 1 | PRD exists and is complete | Missing required sections |
| 2 | PRD and ADR(s) are consistent | Contradictions between them |
| 3 | Phase scope matches PRD goals | Phase implements something not in PRD |
| 4 | DB changes follow naming conventions | Wrong prefix, camelCase columns, missing `id`/timestamps |
| 5 | Version bump is specified and correct | Missing, or PATCH when schema changes |
| 6 | No contradictions between ADRs | Two ADRs make incompatible decisions |
| 7 | Acceptance criteria are testable | Vague criteria with no measurable outcome |
| 8 | Risks are identified | Non-trivial features with no risk section |

---

## Output Format

```
PASS — PRD exists and is complete
FAIL — Version bump missing; DB schema change requires MINOR
WARN — Risk section is sparse; consider noting migration risk
```

**Do NOT proceed to `/build` until all checks are PASS (WARNs are acceptable).**

State clearly at the end: `Ready to build` or `Needs revision — see failures above`.
