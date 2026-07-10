# Phase: Flow Selector Search Button

**Version bump:** PATCH → 1.23.4
**Status:** To be implemented

---

## Problem

On `/admin/dashboards/flows`, all flow cards are rendered in a wrapping flex row. When there are many flows, the selector area grows to multiple rows, making it hard to scan and select the right flow.

## Solution

When there are more than 5 flow cards, cap the visible cards at 5 and append a "Search for more" button at the far right of the row. Clicking it replaces the button with an auto-suggest combobox that filters all loaded flows by name. Selecting a flow from the dropdown selects it and dismisses the input.

Cards are already sorted by session count descending in `GetFlowDeepDive` — no backend change is needed.

---

## Scope

**Files modified:**
- `apps/web/src/app/(admin)/admin/dashboards/flows/_content.tsx`

**Files added:**
- `apps/web/e2e/enhance-flow-selector-search.spec.ts` (Playwright test)

**No DB changes. No domain or use-case changes.**

---

## Behaviour spec

### Threshold
- Constant `FLOW_CARD_THRESHOLD = 5`
- When `data.flows.length <= FLOW_CARD_THRESHOLD`: render all cards as today, no search button

### Search button
- When `data.flows.length > FLOW_CARD_THRESHOLD`: render only the first 5 cards, then a "Search for more" button styled consistently with the existing cards (bordered, rounded-[9px], muted text)
- Button sits in the same flex row as the visible cards

### Auto-suggest input
- Clicking "Search for more" swaps the button for a combobox-style input (text input + dropdown list)
- The input is focused automatically
- As the user types, the dropdown filters `data.flows` (all flows, not just the capped 5) by name (case-insensitive substring match), showing flow name + session count
- Pressing Escape or clicking outside closes the search input and restores the "Search for more" button
- Selecting a flow sets it as active and closes the input

### Card ordering
- The first 5 visible cards are the top 5 by session count (already guaranteed by use-case sort)

---

## Acceptance criteria

1. With ≤ 5 flows: no "Search for more" button visible
2. With > 5 flows: only 5 cards shown, "Search for more" on the right
3. Clicking "Search for more" opens the auto-suggest input, focused
4. Typing filters the dropdown to matching flow names
5. Clicking a flow from the dropdown selects it and closes the input
6. Pressing Escape closes the input without changing selection
7. The selected flow's data (charts, table) updates as normal
