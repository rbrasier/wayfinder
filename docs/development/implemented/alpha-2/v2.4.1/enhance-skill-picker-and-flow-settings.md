# Enhancement — Skill Picker Modal + Flow Settings Menu (v2.4.1)

**Status:** Implemented
**Version:** 2.4.1 (PATCH — UI only, no schema/API change)
**Addresses:** Richard's review on fork PR #132 (items #3a, #3c)

> Two of the UX cleanups Richard asked for on the original fork PR. Ported the
> skills-only slice of `f90e978` — deliberately **excluding** the MCP
> Context/Actions redesign bundled in the same fork commit (that is review item
> #1b, still deferred to its own phase).

## What changed

### #3a — Skill selection as a compact button + modal (was an inline checklist)
- New `SkillPickerModal` (searchable, multi-select) opened from a small
  "Add skills" button on the top-right of the **Instructions for the AI** box.
- Selected skills render as removable chips above the instructions textarea; the
  button shows a count (`Skills · N`). The always-visible inline checkbox list is
  gone, so a conversational step reads clean by default.
- Gated by the `skills` power-user flag (the button/chips only show when enabled).

### #3c — "Flow Settings" admin sub-menu
- Added a labelled **Flow Settings** group to the admin sidebar (matching the
  existing "User Admin" grouping pattern) containing **Skills**, **MCP Servers**,
  and **Knowledge**; removed Skills/MCP Servers from the top-level admin list.
- n8n has no standalone admin route (it lives inside Configuration), so it stays
  there — matching Richard's tentative "probably n8n settings".

## Files

- created: `apps/web/src/components/canvas/skill-picker-modal.tsx`,
  `tests/e2e/enhance-skill-picker-and-flow-settings.spec.ts`, this doc
- modified: `apps/web/src/components/canvas/node-config-modal.tsx` (button +
  chips + modal wiring; removed inline skill checklist),
  `apps/web/src/components/sidebar.tsx` (Flow Settings group)

## Not included (still deferred — review item #1b)

- MCP server `kind` (Context/Actions), flow-wide context-server selection, and
  the human-in-the-loop **confirm-before-run** flow for write actions. That is
  the substantive architectural request from Richard's review and warrants its
  own phase.

## Verification

- Web app typechecks clean; jsx-a11y strict passes; canvas component tests green.
- e2e (`enhance-skill-picker-and-flow-settings.spec.ts`) covers the picker button/
  modal and the Flow Settings grouping — requires a running stack; not run here.

## Version

PATCH: `2.4.0 → 2.4.1` (UI only).
