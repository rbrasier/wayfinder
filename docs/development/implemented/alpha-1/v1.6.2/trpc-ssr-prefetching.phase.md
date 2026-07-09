# Phase — tRPC Server-Side Prefetching

- **Status**: Awaiting Implementation
- **Target version**: `1.6.2` (bump: PATCH — no schema changes, pure infrastructure)
- **ADR**: [ADR 012](../adr/012-trpc-ssr-prefetching.adr.md)

---

## 1. Problem

Admin and user pages each fire 2–4 separate `useQuery` calls after client
hydration. Because there is no server-side cache warm-up, the browser
experiences a waterfall: page JS loads → client fires queries → data renders.
Observed as 3–4 separate `flow.list` HTTP requests on a single `/admin/flows`
page visit.

---

## 2. Goals

- Every admin and user page delivers its primary data pre-populated in the React
  Query cache on first render — no client-side fetch needed.
- Existing `useQuery` hooks in client components require zero changes.
- Layout-level shared data (`user.me`, `flow.list`, `user.list`) is prefetched
  once in the layout and reused by all child pages without additional requests.

---

## 3. Non-goals

- Streaming SSR / Suspense boundaries (deferred).
- Prefetching data that requires user interaction to determine (e.g. paginated
  error detail panels).
- Replacing tRPC mutations — these continue to use `utils.*.invalidate()` for
  post-write refresh.

---

## 4. Approach

Use `createHydrationHelpers` from `@trpc/react-query/rsc`. See ADR 012 for the
full rationale.

Each server layout/page:

1. Reads the session cookie via `cookies()` from `next/headers`.
2. Creates a per-request tRPC caller with full auth context.
3. Calls `trpc.<router>.<proc>.prefetch(input)` for each query the page needs.
4. Wraps its children in `<HydrateClient>` which dehydrates the `QueryClient`
   state and sends it to the browser.

`React.cache()` ensures a single `QueryClient` instance per server request
across nested server components.

---

## 5. Files to create

### `apps/web/src/lib/query-client.ts`

Shared `QueryClient` factory. Configures `staleTime`, `retry`, and the
superjson `serializeData`/`deserializeData` transformer hooks required by
`createHydrationHelpers`.

```typescript
import { QueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import superjson from "superjson";

const retryFn = (failureCount: number, error: unknown): boolean => {
  if (error instanceof TRPCClientError) {
    const status = error.data?.httpStatus as number | undefined;
    if (status !== undefined && status >= 400 && status < 500) return false;
  }
  return failureCount < 3;
};

export const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: retryFn,
      },
      dehydrate: { serializeData: superjson.serialize },
      hydrate: { deserializeData: superjson.deserialize },
    },
  });
```

Note: `staleTime` is bumped from 5 s → 30 s to reduce re-fetches on navigation.
The transformer hooks are required by `createHydrationHelpers` for the
dehydration/hydration boundary to round-trip superjson-encoded types correctly.

---

### `apps/web/src/server/server-context.ts`

Server-side tRPC context builder. Reads the session cookie directly from
Next.js `cookies()` instead of from a `Request` object.

```typescript
import { cookies } from "next/headers";
import { getContainer } from "@/lib/container";
import type { TrpcContext } from "./trpc";

export const createServerTrpcContext = async (): Promise<TrpcContext> => {
  const cookieStore = await cookies();
  const token = cookieStore.get("better-auth.session_token")?.value ?? null;
  const container = getContainer();

  let userId: string | null = null;
  let isAdmin = false;

  if (token) {
    const session = await container.resolveSession(token);
    if (session) {
      userId = session.userId;
      isAdmin = session.isAdmin;
    }
  }

  return { container, userId, isAdmin, headers: new Headers() };
};
```

---

### `apps/web/src/trpc/server.ts`

Per-request server-side helpers factory. Uses `React.cache` to ensure a single
`QueryClient` and single context resolution per server render tree.

```typescript
import "server-only";
import { createHydrationHelpers } from "@trpc/react-query/rsc";
import { cache } from "react";
import { appRouter, type AppRouter } from "@/server/router";
import { createTRPCCaller } from "@trpc/server"; // or t.createCallerFactory
import { createServerTrpcContext } from "@/server/server-context";
import { createQueryClient } from "@/lib/query-client";

export const getQueryClient = cache(createQueryClient);

const createCaller = appRouter.createCaller; // tRPC v11 pattern; verify against node_modules

export const createServerHelpers = async () => {
  const context = await createServerTrpcContext();
  const caller = createCaller(context);
  return createHydrationHelpers<AppRouter>(caller, getQueryClient);
};
```

**Important**: Verify the exact `createCaller` / `createCallerFactory` API
shape against `node_modules/@trpc/server` before writing — do not rely on
training data. The `t.createCallerFactory` pattern from `trpc.ts` is the
reference.

---

## 6. Files to modify

### `apps/web/src/trpc/Provider.tsx`

Replace the inline `QueryClient` construction with `createQueryClient()` from
the shared factory. Remove the inline `retryFn` (it moves to `query-client.ts`).

```typescript
// Before
const [queryClient] = useState(
  () => new QueryClient({ defaultOptions: { queries: { staleTime: 5_000, retry: retryFn } } }),
);

// After
import { createQueryClient } from "@/lib/query-client";
const [queryClient] = useState(() => createQueryClient());
```

---

### `apps/web/src/app/(admin)/admin/layout.tsx`

Convert to an async server component. Prefetch the three queries shared across
all admin pages.

```typescript
import { createServerHelpers } from "@/trpc/server";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { trpc, HydrateClient } = await createServerHelpers();

  void trpc.user.me.prefetch();
  void trpc.flow.list.prefetch();
  void trpc.user.list.prefetch({});

  return (
    <SidebarProvider>
      <HydrateClient>
        <div className="flex h-screen overflow-hidden">
          <AppSidebar isAdmin={true} />
          <div className="flex flex-1 flex-col overflow-hidden bg-[#f7f6f3]">
            {children}
          </div>
        </div>
      </HydrateClient>
    </SidebarProvider>
  );
}
```

---

### `apps/web/src/app/(user)/layout.tsx`

Same pattern for the user layout.

Check the current file for its actual structure, then add:

```typescript
const { trpc, HydrateClient } = await createServerHelpers();

void trpc.user.me.prefetch();
void trpc.session.listPublishedFlows.prefetch();
```

Wrap the layout children in `<HydrateClient>`.

---

## 7. Pages that need server/client splits

For each page below: the current `"use client"` file becomes `_content.tsx`
(rename, keep all existing code), and a new `page.tsx` (server component) is
created to prefetch then render `<HydrateClient><PageContent /></HydrateClient>`.

The `HydrateClient` in each page is additive — React Query merges dehydrated
state from nested `HydrateClient` boundaries, so the layout's data and the
page's data are both available to client components.

---

### `/admin/errors`

**New `page.tsx`**
```typescript
import { createServerHelpers } from "@/trpc/server";
import { AdminErrorsContent } from "./_content";

export default async function AdminErrorsPage() {
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.error.listGrouped.prefetch({});
  return <HydrateClient><AdminErrorsContent /></HydrateClient>;
}
```

**Rename current `page.tsx` → `_content.tsx`**, export the component as
`AdminErrorsContent` (named export, not default).

---

### `/admin/flags`

```typescript
void trpc.featureFlag.list.prefetch();
```

Export current component as `AdminFlagsContent`.

---

### `/admin/sessions`

```typescript
void trpc.session.listAll.prefetch();
// flow.list and user.list already warm from admin layout
```

Export current component as `AdminSessionsContent`.

---

### `/admin/usage`

```typescript
void trpc.usage.summary.prefetch(undefined);
```

Export current component as `AdminUsageContent`.

---

### `/chats`

```typescript
void trpc.session.list.prefetch();
// session.listPublishedFlows already warm from user layout
```

Export current component as `ChatsContent`.

---

### `/flows` (user flows list)

```typescript
void trpc.flow.listMine.prefetch();
```

Export current component as `UserFlowsContent`.

---

## 8. Dynamic route pages

These pages have route params available in the server component, so they can
be fully prefetched.

### `/admin/flows/[id]`

**New `page.tsx`**
```typescript
export default async function AdminFlowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.flow.getCanvas.prefetch({ flowId: id });
  return <HydrateClient><AdminFlowContent flowId={id} /></HydrateClient>;
}
```

Pass `flowId` as a prop to the content component so it can call
`trpc.flow.getCanvas.useQuery({ flowId })` without needing to read params
client-side.

---

### `/chats/[sessionId]`

```typescript
export default async function ChatSessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.session.get.prefetch({ sessionId });
  // user.me already warm from user layout
  return <HydrateClient><ChatSessionContent sessionId={sessionId} /></HydrateClient>;
}
```

---

## 9. Pages with no changes needed

| Page | Reason |
|------|--------|
| `/admin/login` | No queries; pre-auth page |
| `/admin` (index) | Server component, no queries |
| `/admin/settings` | Server component, no queries |
| `/admin/users` | `user.list` already warm from admin layout |
| `/admin/flows` (list) | `flow.list` + `user.list` already warm from admin layout |
| `/settings` | Server component, no queries |
| `/sample` | Dev-only, mutations only |

---

## 10. Implementation order

1. `lib/query-client.ts` — foundation, no dependencies
2. `server/server-context.ts` — foundation, no dependencies
3. `trpc/server.ts` — depends on 1 + 2
4. `trpc/Provider.tsx` — update to use shared factory from 1
5. Admin layout — prefetch shared data
6. User layout — prefetch shared data
7. Static page splits (errors, flags, sessions, usage, chats, flows) — can be done in parallel
8. Dynamic route splits (flows/[id], chats/[sessionId]) — do last; slightly more complex

Validate after each step with `./validate.sh`.

---

## 11. Verification checklist

- [ ] `./validate.sh` passes after each step
- [ ] `/admin/flows` server logs show `flow.list` appearing only once (in the
      initial HTML response, not as a client-side tRPC call) on first load
- [ ] Subsequent `useQuery` calls in client components do not trigger network
      requests (React Query DevTools shows `status: success` before any fetch)
- [ ] Mutations (`flow.create`, `session.overrideBranch`, etc.) still trigger
      cache invalidation and re-fetch correctly
- [ ] Admin login page (`/admin/login`) is unaffected — `createServerHelpers`
      is not called there
- [ ] TypeScript compiles with no errors (`pnpm tsc --noEmit`)
