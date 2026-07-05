# Phase 5 — UI Design Fidelity

- **Status**: Awaiting Implementation
- **Target version**: `1.5.2` (bump: PATCH — UI polish only, no schema or API changes)
- **PRD**: N/A — derives from gap analysis against existing mockups
- **Mockups**: [`../mockups/FlowAgent.html`](../mockups/FlowAgent.html), [`../mockups/FlowAgent Chat.html`](<../mockups/FlowAgent Chat.html>), [`../mockups/FlowAgent Configure.html`](<../mockups/FlowAgent Configure.html>)
- **Depends on**: Phase 4 (v1.5.0)

## 1. Problem

A Playwright audit of the deployed app revealed that the UI diverges from the mockups in several structural and visual ways:

1. **Wrong colour palette** — background is pure white (`#fff`) instead of the mockup's warm off-white (`#f7f6f3`); primary buttons are near-black instead of vivid indigo (`#3a5fd9`); borders are cool blue-grey instead of warm sand (`#dedad2`).
2. **No sidebar** — all three mockups show a persistent 56 px icon sidebar; the app has none.
3. **Admin canvas incomplete** — missing `<MiniMap>`, `<Controls>`, and auto-fit logic (present on the user canvas but not the admin canvas).
4. **Missing toast triggers** — share-copy, document-download, session-start, flow-name-save, and node-delete have no feedback toasts.
5. **Stale developer notes in UI** — `DocumentCard` still shows "Phase 4 moves to durable object storage" to end users.
6. **Disabled "Open Chat" button** — still carries `disabled title="Available in Phase 2"` even though Phase 2 shipped.
7. **No route-level error boundaries** — only a global `error.tsx` exists; individual route segments lack co-located `error.tsx` files.
8. **Dark mode never activates** — CSS tokens are defined under `.dark` class but no ThemeProvider reads the system preference.
9. **Step-rail green** — uses Tailwind `emerald-500` (`#10b981`) instead of mockup's `#2e9e6a`.

## 2. Goals

- All pages share the warm off-white background, vivid-indigo primary, and warm-sand border from the mockups.
- A persistent icon sidebar appears on every user and admin page (collapses to bottom nav on mobile).
- All non-canvas pages are usable on viewports ≥ 360 px (no horizontal scroll, no clipped content).
- Admin canvas has parity with user canvas (MiniMap, Controls, auto-fit).
- All Phase 4 toast triggers are present.
- No stale developer copy is shown to end users.
- Route-level error boundaries cover `/chats`, `/chats/[sessionId]`, `/admin/flows`, and `/admin/sessions`.
- Dark mode respects `prefers-color-scheme` via Tailwind `darkMode: "media"`.

## 3. Non-goals

- No new features, domain changes, or database migrations.
- No design system extraction — changes are scoped to `apps/web`.
- Canvas pages (`/admin/flows/[id]` and `/flows/[id]/config`) remain desktop-only (documented in PRD §4).

## 4. Key entities / files

| File | Change |
|---|---|
| `apps/web/src/styles/globals.css` | Update CSS custom properties; swap `.dark` block for `@media (prefers-color-scheme: dark)` |
| `apps/web/tailwind.config.ts` | `darkMode: ["media"]` |
| `apps/web/src/components/sidebar.tsx` | New icon sidebar component (desktop) + bottom nav (mobile) |
| `apps/web/src/app/(user)/layout.tsx` | New layout wrapping content with Sidebar |
| `apps/web/src/app/(admin)/admin/layout.tsx` | Update to include Sidebar |
| `apps/web/src/app/(admin)/admin/flows/[id]/page.tsx` | Add MiniMap, Controls, fitView, toast on save/delete, enable Open Chat |
| `apps/web/src/components/chat/share-button.tsx` | Add `toast.success` |
| `apps/web/src/components/chat/document-card.tsx` | Add `toast.success` on download; remove stale copy |
| `apps/web/src/components/chat/new-chat-modal.tsx` | Add `toast.success` on session start |
| `apps/web/src/components/chat/step-progress-rail.tsx` | Replace emerald tokens with `#2e9e6a` |
| `apps/web/src/app/(user)/chats/error.tsx` | New route error boundary |
| `apps/web/src/app/(user)/chats/[sessionId]/error.tsx` | New route error boundary |
| `apps/web/src/app/(admin)/admin/flows/error.tsx` | New route error boundary |
| `apps/web/src/app/(admin)/admin/sessions/error.tsx` | New route error boundary |

## 5. Acceptance criteria

- [ ] `/chats` page body background is `#f7f6f3`; "New Chat" button is `#3a5fd9`.
- [ ] Card borders are warm sand, not cool blue-grey.
- [ ] A 56 px white sidebar with brand mark and icon nav appears on all user and admin pages on `md+` viewports; on mobile a bottom nav bar appears instead.
- [ ] `/chats`, `/admin/flows`, `/admin/sessions` are usable at 360 px width (no horizontal scroll).
- [ ] Admin canvas (`/admin/flows/[id]`) has zoom controls and a minimap visible.
- [ ] Admin canvas auto-fits when flow has > 3 nodes on first load.
- [ ] Clicking "Share" in chat triggers `toast.success("Link copied")`.
- [ ] Downloading a document triggers `toast.success("Downloading…")`.
- [ ] Starting a new chat triggers `toast.success("Chat started")`.
- [ ] Saving flow name in admin canvas triggers `toast.success("Flow saved")`.
- [ ] Deleting a node triggers `toast.success("Step deleted")`.
- [ ] `DocumentCard` shows no "Phase 4" or "volume-mounted storage" copy.
- [ ] "Open Chat" in admin canvas is a working link to `/chats`.
- [ ] Throwing from `/chats` renders a route-level error boundary with "Try again".
- [ ] System dark-mode preference is reflected without manual class toggle.
- [ ] Step-rail completed circles are `#2e9e6a`.
- [ ] `VERSION` and `package.json#version` = `1.5.2`. `validate.sh` passes.

## 6. Build order

Single session — all changes are in `apps/web`, no cross-package coordination needed.

1. CSS tokens + Tailwind dark-mode config
2. Sidebar component
3. Layout updates (user + admin)
4. Admin canvas parity (MiniMap, Controls, fitView, toasts, Open Chat)
5. Remaining toast fixes (ShareButton, DocumentCard, NewChatModal)
6. DocumentCard stale copy removal
7. Step-rail colour fix
8. Route-level error boundaries
9. Version bump → `validate.sh`

## 7. Validation

`./validate.sh` after all changes. Move this file to `docs/development/implemented/v1.5.2/`.
