# Bug Fix — Sticky Link Navigation

## Symptom

Clicking a link (most noticeably the sidebar nav and Recent Chats links) feels
"sticky": the click appears to do nothing for a beat, the old page stays fully on
screen, and then the new page suddenly appears. It does not feel like the click
"follows through" to a real navigation the way a classic web request does.

## Reproduction

1. Sign in and land on `/chats`.
2. Click a sidebar item (e.g. **Flows**) or a **Recent Chats** entry.
3. Observe: the current page stays visible with no feedback while the destination
   does its server work, then swaps in abruptly.

Most pronounced in `next dev` (see Root Cause #3).

## Root Cause (verified in code)

This is a Next.js App Router app. All navigation uses `<Link>` (soft client-side
navigation). Three things combine to produce the stickiness:

1. **Every destination blocks on async server work before it can render.** Each
   route is an `async` server component that calls `createServerHelpers()` —
   which resolves the session — and then `void trpc.*.prefetch()` wrapped in
   `HydrateClient`. The RSC hydration helper waits for the prefetched tRPC queries
   to settle so it can serialize them into the hydration boundary. So the
   destination's RSC payload is not ready until that work finishes.

2. **There are no `loading.tsx` Suspense boundaries anywhere in `apps/web/src`.**
   Without a boundary, the App Router keeps the *previous* page fully on screen
   until the destination segment is completely ready. There is no fallback to
   show, so the click produces no visible change during the wait — the "sticky"
   feeling. tRPC is involved only as the slow work being awaited; it is not
   intercepting or proxying the link.

3. **`next dev` disables `<Link>` prefetching.** In a production build, `<Link>`
   prefetches the destination RSC on hover/viewport, so most clicks are already
   instant. A large part of the perceived stickiness is dev-only and will be much
   less visible in production.

## Fix Plan

Goal (per product owner): instant, *subtle* feedback on every click while keeping
fast client-side navigation. No hard full-page reloads.

1. **Global navigation progress indicator** — a single subtle 2px top bar
   (`NavigationProgress`) mounted in the root layout. It starts on any same-origin
   soft-navigation link click (detected in the capture phase) and completes when
   `usePathname()` changes. One component covers every link, Recent Chats, and the
   sidebar `router.push()` buttons render anchors too. The start/skip decision is a
   pure, unit-tested helper (`shouldStartNavigation`).

2. **`loading.tsx` Suspense boundaries** on the heavy segments so a navigation can
   swap instantly to a subtle skeleton instead of holding the old page hostage:
   - `app/(user)/loading.tsx`
   - `app/(admin)/loading.tsx`
   - `app/(user)/chats/[sessionId]/loading.tsx`

3. **Follow-up (documented, not done here):** the `void prefetch()` + `HydrateClient`
   pattern intentionally trades navigation speed for "no client loading flash". For
   any route still slow after the above, wrap the data-dependent sections in
   `<Suspense>` and let them stream (the app already uses `httpBatchStreamLink`),
   rather than blocking the RSC on prefetch.

## Tests

- **Unit (regression guard):** `navigation-progress-intent.test.ts` covers
  `shouldStartNavigation` — external links, modified clicks (cmd/ctrl/middle),
  `target=_blank`, downloads, and same-URL clicks must NOT start the bar; a plain
  same-origin link to a different path must.
- **E2E:** `e2e/fix-sticky-link-navigation.spec.ts` clicks a sidebar link and
  asserts the navigation indicator appears immediately and the destination renders.

## Version

PATCH bump (minor severity, no schema/API change): `1.48.3` → `1.48.4`.
