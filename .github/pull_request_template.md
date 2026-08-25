<!--
  Wayfinder pull request template.

  Fill all four sections. If one genuinely does not apply, replace its content
  with a one-line reason — "No UI impact — server-side only" — rather than
  deleting the heading or leaving a bare "N/A". The reason is what tells a
  reviewer you considered it.

  Delete these comment blocks as you fill them in.
-->

## Summary

<!--
  One paragraph. What this change does and what it means for the product,
  in the terms a reviewer who has not read the diff would use. Not a file list.
-->

## Impact

**Features affected:**

<!--
  Name the areas this change moves. Delete the ones it does not touch.

  User-facing — Chats · Flow editor · Synthesise · Knowledge base ·
  Approvals · User settings
  Admin — Users · Roles · Groups · Organisations · Flows · Skills ·
  Schedules · MCP servers · Admin settings · Audit log · Usage ·
  Errors · Feature flags · Sessions
  Reporting — Dashboards · Insights · Exports
  Cross-cutting — Auth & sessions · API (apps/api) · Background jobs ·
  Framework packages (@rbrasier/*)
-->

**Business rules changed:**

<!--
  One bullet per rule added, altered or removed. State the triggering condition
  and the resulting behaviour, so the rule can be checked against the code:

  - When a session's status becomes `approved`, the document locks and further
    revisions are rejected.
  - Confidence below 0.4 no longer blocks progression; it raises a warning the
    operator can dismiss.

  If none changed, say so with the reason — "No business rules changed —
  presentation only".
-->

-

## UI Impact

<!--
  One bullet per thing a user experiences differently. Write it the way the
  user would describe it, not the way the code does — screens, states, copy,
  empty states, error states, what disappears, what is now reachable that
  was not.

  - The flow editor's node panel gains an "Advanced" section, collapsed by
    default; existing node settings are unchanged and stay above it.
  - Uploading a file larger than 25 MB now fails immediately with an inline
    message naming the limit, instead of after the upload completes.

  If nothing visible changed, say so with the reason — "No UI impact —
  background job only".
-->

-

## Why this change is required

<!--
  One paragraph, or bullets. The use case being served or the problem being
  solved: what a user could not do, or what was going wrong, before this.
  Link the issue, bug report, PRD or ADR if there is one.
-->

<details>
<summary>Implementation detail</summary>

- **Version:** <!-- MINOR or PATCH, and the resulting version -->
- **Files created / modified:** <!-- grouped by domain / application / adapters / apps -->
- **Migrations:** <!-- generated migration filename and its `-- data-impact:` line, or "none" -->
- **Tests:** <!-- test files added, and either the e2e spec extended with its
                 e2e-test-policy.md group, or "no e2e — covered at <layer>" -->
- **Known limitations:** <!-- or "none" -->
- **Deviations from the approved change summary:** <!-- or "none" -->

</details>
