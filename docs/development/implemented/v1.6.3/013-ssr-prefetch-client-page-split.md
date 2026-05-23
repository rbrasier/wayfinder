# Bug Fix: SSR Prefetch Bypassed by Client-Component Pages

**Version:** 1.6.3 (PATCH)
**Date:** 2026-05-24
**Status:** Implemented

---

## Implementation Summary

**Root cause confirmed:** Three `page.tsx` files carried `"use client"`, making them
pure client components. Next.js caches the layout RSC payload during SPA navigation,
so the layout's `HydrateClient` never re-ran and no data was hydrated into the
client cache on navigation.

**Fix applied:** Applied the standard `page.tsx` (async server) + `_content.tsx`
(client) split to all three affected pages:

| Page | Content file | Queries prefetched |
|------|-------------|-------------------|
| `(admin)/admin/flows/page.tsx` | `_content.tsx` → `AdminFlowsContent` | `flow.list`, `user.list` |
| `(admin)/admin/users/page.tsx` | `_content.tsx` → `AdminUsersContent` | `user.list` |
| `(user)/flows/[id]/config/page.tsx` | `_content.tsx` → `FlowOwnerCanvasContent` | `flow.getCanvas` |

**Regression test added:** `apps/web/src/app/page-ssr-structure.test.ts` — asserts
that none of the three page files start with `"use client"`.

---

## Symptom

`flow.list`, `user.list`, and `flow.getCanvas` are fetched via HTTP GET on the
client after page load, despite the layout prefetching them on the server.
The dev-server log shows requests like:

```
GET /api/trpc/flow.list?batch=1&... 200 in 62ms
```

---

## Root Cause

Three `page.tsx` files carry `"use client"` at the top, making the page itself
a client component:

| File | Queries |
|------|---------|
| `(admin)/admin/flows/page.tsx` | `flow.list`, `user.list` |
| `(admin)/admin/users/page.tsx` | `user.list` |
| `(user)/flows/[id]/config/page.tsx` | `flow.getCanvas` |

Next.js App Router **caches the layout RSC payload** on the client during
SPA navigation. When the user navigates to one of these routes, the layout's
`HydrateClient` is not re-executed on the server, so no dehydrated cache data
is injected. The client component page mounts with an empty React Query cache
and `useQuery()` fires a network request.

The correct pattern — used by every other page in the app (e.g.
`(admin)/admin/flags/page.tsx`, `(admin)/admin/flows/[id]/page.tsx`) — is:

```
page.tsx          ← async server component: createServerHelpers() + prefetch + HydrateClient
_content.tsx      ← "use client": all hooks and interactivity
```

---

## Reproduction

1. Navigate to `/admin/flows`, `/admin/users`, or a flow config page.
2. Observe the network tab — a GET request to `/api/trpc/flow.list` (or
   equivalent) fires after the page renders.

---

## Fix Plan

For each affected page:

1. Replace `page.tsx` with an async server component that:
   - Calls `createServerHelpers()`
   - Prefetches the queries needed by that page
   - Returns `<HydrateClient><PageContent /></HydrateClient>`
2. Create `_content.tsx` as a `"use client"` component containing the current
   page logic, receiving any route params as props.

**`(admin)/admin/login/page.tsx`** and **`(user)/sample/page.tsx`** also carry
`"use client"` but make no tRPC queries, so they are out of scope.

---

## Regression Test

`apps/web/src/app/page-ssr-structure.test.ts` — asserts that the three pages
do not contain `"use client"`, providing a structural regression guard.
