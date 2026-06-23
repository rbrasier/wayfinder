# v1.48.4 — Fix: sticky link navigation

## Symptom

Clicking a link — most noticeably the sidebar nav and Recent Chats links — felt
"sticky": the click appeared to do nothing for a beat, the previous page stayed
fully on screen, then the destination suddenly swapped in. It did not feel like
the click "followed through" to a real navigation.

## Root cause

A Next.js App Router behaviour, not a tRPC link proxy:

1. Every route is an `async` server component that resolves the session and
   `void trpc.*.prefetch()`s inside `HydrateClient`. The RSC hydration helper waits
   for those prefetched queries to settle, so the destination's payload is not
   ready until that server work completes.
2. There were **no `loading.tsx` Suspense boundaries** anywhere in `apps/web/src`.
   Without a boundary the App Router keeps the *previous* page on screen until the
   destination is fully ready, with no fallback to show — so the click produced no
   visible change during the wait. tRPC was only the slow work being awaited.
3. `next dev` disables `<Link>` prefetching, which amplified the effect in
   development (production `<Link>` prefetches on hover/viewport).

## Fix applied

Instant, subtle feedback on every click while keeping fast client-side navigation
(no hard reloads):

- **Global navigation progress bar** — `apps/web/src/components/navigation-progress.tsx`,
  a deliberately subtle 2px top bar mounted once in the root layout. It starts on
  any same-origin soft-navigation link click (detected in the capture phase) and
  completes when `usePathname()` changes. The start/skip decision is a pure helper,
  `shouldStartNavigation`, in `navigation-progress-intent.ts`.
- **`loading.tsx` Suspense boundaries** so navigations swap instantly to a subtle
  skeleton instead of holding the old page hostage:
  - `apps/web/src/app/(user)/loading.tsx`
  - `apps/web/src/app/(admin)/loading.tsx`
  - `apps/web/src/app/(user)/chats/[sessionId]/loading.tsx`

Files changed:

- `apps/web/src/components/navigation-progress-intent.ts` (new)
- `apps/web/src/components/navigation-progress-intent.test.ts` (new)
- `apps/web/src/components/navigation-progress.tsx` (new)
- `apps/web/src/app/layout.tsx` (mount the bar)
- `apps/web/src/app/(user)/loading.tsx` (new)
- `apps/web/src/app/(admin)/loading.tsx` (new)
- `apps/web/src/app/(user)/chats/[sessionId]/loading.tsx` (new)
- `apps/web/e2e/fix-sticky-link-navigation.spec.ts` (new)

## Follow-up (documented, not done here)

The `void prefetch()` + `HydrateClient` pattern intentionally trades navigation
speed for "no client loading flash". For any route still slow after this fix, wrap
the data-dependent sections in `<Suspense>` and let them stream (the app already
uses `httpBatchStreamLink`) rather than blocking the RSC on prefetch.

## Regression test added

`navigation-progress-intent.test.ts` covers `shouldStartNavigation`: external
links, modified clicks (cmd/ctrl/middle button), `target=_blank`, downloads, and
same-URL / hash-only clicks must NOT start the bar; a plain same-origin link to a
different path (or differing query) must. These fail before the helper existed.
Run: `pnpm --filter @wayfinder/web test navigation-progress-intent` — 11 passing.

## E2E test added

`apps/web/e2e/fix-sticky-link-navigation.spec.ts` clicks the **Flows** sidebar link
and asserts that instant feedback appears (the progress bar or a loading skeleton)
and that the URL follows through to `/flows`. It is driven by the /e2e Playwright
MCP skill against a running, signed-in stack (excluded from the vitest unit run),
so it was not executed in the fix sandbox (no running stack available there); the
deterministic regression guard is the unit test above.

## Version

PATCH bump: `1.48.3` → `1.48.4` (UI behaviour fix, no schema or API change).
