# v1.5.2 — UI Design Fidelity Implementation Summary

**Version**: `1.5.2` (PATCH)  
**Phase doc**: `phase-5-ui-design-fidelity.phase.md`

## What changed

### Visual tokens
- `globals.css`: Updated all CSS custom properties to match mockup palette — warm off-white background (`#f7f6f3` → `hsl(40, 20%, 96%)`), vivid indigo primary (`#3a5fd9` → `hsl(226, 67%, 54%)`), warm sand border (`#dedad2` → `hsl(38, 16%, 83%)`), pure white cards.
- `tailwind.config.ts`: Switched `darkMode` from `["class"]` to `["media"]` so dark mode activates from system preference without a ThemeProvider.
- `globals.css`: Replaced `.dark {}` block with `@media (prefers-color-scheme: dark)` block.

### Sidebar
- New `apps/web/src/components/sidebar.tsx` — 56 px white icon sidebar (desktop) + fixed bottom nav (mobile ≤ md). Displays brand "W" mark and context-appropriate nav icons. Returns null on `/admin/login`.
- New `apps/web/src/app/(user)/layout.tsx` — wraps all user routes in `flex h-screen overflow-hidden` with the sidebar.
- Updated `apps/web/src/app/(admin)/admin/layout.tsx` — replaced header-nav with sidebar; same flex container.

### Scroll / height fixes
- All non-canvas admin pages wrapped in `<div className="h-full overflow-auto"><div className="container py-8">` so they scroll within the fixed-height flex layout.
- User `/chats/page.tsx` and `/settings/page.tsx` wrapped similarly with mobile bottom-nav padding.
- Chat session page: `h-screen` → `h-full`.
- User canvas page: `style={{ height: "100vh" }}` → `className="h-full"`.

### Admin canvas parity
- Rewrote `apps/web/src/app/(admin)/admin/flows/[id]/page.tsx` to use `ReactFlowProvider` + `useReactFlow`. Added `<Controls />`, `<MiniMap zoomable pannable />`, and auto-fit when node count > 3.
- Added `toast.success("Flow saved")` on flow name update and `toast.success("Flow published/unpublished")` on status toggle.
- Added `toast.success("Step deleted")` on node delete (both admin and user canvas).
- Enabled "Open Chat" button as `<Link href="/chats">`.

### Missing toasts
- `ShareButton`: replaced visual "Copied!" state with `toast.success("Link copied")`.
- `DocumentCard`: added `toast.success("Downloading…")` after successful download.
- `NewChatModal`: added `toast.success("Chat started")` on session creation.

### Content fixes
- `DocumentCard`: removed stale "Phase 4 moves to durable object storage" and "Requires volume-mounted storage" copy. Unavailable message simplified to "File no longer available. Try regenerating."

### Step rail colour
- Replaced all Tailwind `emerald-*` tokens with `#2e9e6a` arbitrary values to match mockup.

### Error boundaries
- Added route-level `error.tsx` at: `/chats`, `/chats/[sessionId]`, `/admin/flows`, `/admin/sessions`.

## Files added
- `apps/web/src/components/sidebar.tsx`
- `apps/web/src/app/(user)/layout.tsx`
- `apps/web/src/app/(user)/chats/error.tsx`
- `apps/web/src/app/(user)/chats/[sessionId]/error.tsx`
- `apps/web/src/app/(admin)/admin/flows/error.tsx`
- `apps/web/src/app/(admin)/admin/sessions/error.tsx`

## Validation
`pnpm typecheck` ✅ · `pnpm lint` ✅ · `pnpm test` ✅ (106 tests passing)
