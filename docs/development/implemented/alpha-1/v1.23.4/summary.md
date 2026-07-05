# v1.23.4 — Flow Selector Search

## What changed

`apps/web/src/app/(admin)/admin/dashboards/flows/_content.tsx`

- Flow cards are capped at 5 (the top 5 by session count, already guaranteed by the use-case sort).
- When more than 5 flows exist, a **"Search for more"** button appears at the far right of the card row.
- Clicking the button replaces it with an auto-suggest text input (`FlowSearchInput` component).
- Typing filters all loaded flows by name (case-insensitive substring match); each option shows name + session count.
- Selecting an option sets that flow as active and closes the input.
- Pressing Escape or clicking outside restores the "Search for more" button without changing selection.
- `onMouseDown` + `event.preventDefault()` on dropdown options prevents the input blur from firing before the selection registers.

## No backend changes

All flows are already returned by `analytics.flowDeepDive` sorted by session count. No new API, no DB migration.

## E2E coverage

`tests/e2e/enhance-flow-selector-search.spec.ts` — covers page load, threshold boundary (≤5 vs >5), input open/focus, filter behaviour, Escape dismiss.
