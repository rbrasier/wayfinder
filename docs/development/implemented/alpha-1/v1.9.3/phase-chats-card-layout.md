# Phase: Chats Card Layout Enhancement

## Version Bump
`1.9.2 → 1.9.3` (PATCH — UI-only, no schema changes)

## Problem
The `/chats` page renders session cards in a responsive multi-column grid (1 → 2 → 3 columns). The intended design is a single full-width column with a richer three-section card layout showing a last message preview and a more detailed progress indicator.

## Goals
- Full-width single-column card list
- Three-section card layout: icon | content | progress
- Last assistant message preview surfaced in the card (no extra DB query — messages already fetched in `session.list`)
- Updated timestamp format: "Today, 10:11 AM" / "Yesterday, 3:22 PM" / "Apr 30, 9:44 AM"
- Skeleton loader matches the new single-column layout

## Non-Goals
- No DB schema changes
- No new API endpoints
- No changes to session detail page

---

## Affected Files

### `apps/web/src/server/routers/session.ts`
- Messages are already fetched per session (line 44) to compute confidence scores
- Add `lastMessage: string | null` to the enriched return — the trimmed content of the last assistant message, or `null` if none

### `apps/web/src/app/(user)/chats/_content.tsx`
- Replace `grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3` with `flex flex-col gap-3`
- Pass `lastMessage` from enriched session data to `SessionCard`

### `apps/web/src/components/chat/session-card.tsx`
New layout structure per card:

```
┌──────────────────────────────────────────────────────┐
│ [icon]  Title text                   [Status badge]  │
│         Flow name · message preview  [Progress bar]  │
│                                      Step X/Y · Z%  Today, 10:11 AM │
└──────────────────────────────────────────────────────┘
```

- Add `lastMessage?: string | null` prop
- Centre section (flex-1): title row, then flow name + preview row
- Right section (fixed ~190px): badge (top-right), progress bar (middle), step counter + timestamp (bottom)
- Update `formatRelativeTime` to return "Today, HH:MM AM/PM", "Yesterday, HH:MM AM/PM", or "MMM D, HH:MM AM/PM"

### `apps/web/src/components/skeleton/card-skeleton.tsx`
- Change `CardSkeletonGrid` wrapper from `grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3` to `flex flex-col gap-3`

---

## Test Plan
- `SessionCard` is a pure presentational component — verify visually in browser
- Validate with `./validate.sh` after changes (type-check, lint, build)
- No unit test changes needed (no logic change, only presentation)
