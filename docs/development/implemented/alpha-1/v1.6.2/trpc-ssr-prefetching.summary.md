# Implementation Summary — tRPC SSR Prefetching (v1.6.2)

## What was built

Server-side tRPC prefetching for all admin and user pages using
`createHydrationHelpers` from `@trpc/react-query/rsc`. On first page load,
primary data is pre-populated in the React Query cache — client components
hit the cache immediately and fire no additional network requests.

## Files created

- `apps/web/src/lib/query-client.ts` — shared `createQueryClient` factory;
  30 s staleTime, superjson dehydrate/hydrate hooks, 4xx-skip retry logic.
- `apps/web/src/lib/query-client.test.ts` — 6 unit tests for the factory.
- `apps/web/src/server/server-context.ts` — `createServerTrpcContext()`;
  reads `better-auth.session_token` cookie via `next/headers`, resolves session.
- `apps/web/src/trpc/server.ts` — `createServerHelpers()` and `getQueryClient`;
  `React.cache` ensures a single `QueryClient` per server render tree.

## Files modified

- `apps/web/src/server/trpc.ts` — added `export const createCallerFactory`
- `apps/web/src/trpc/Provider.tsx` — uses shared `createQueryClient()` factory
- `apps/web/src/app/(admin)/admin/layout.tsx` — async server component;
  prefetches `user.me`, `flow.list`, `user.list`
- `apps/web/src/app/(user)/layout.tsx` — async server component;
  prefetches `user.me`, `session.listPublishedFlows`

## Page server/client splits

Each page was split into `_content.tsx` (client component, named export) and
`page.tsx` (async server component that prefetches then renders `<HydrateClient>`).

**Static pages:**
- `(admin)/admin/errors` — prefetches `error.listGrouped`
- `(admin)/admin/flags` — prefetches `featureFlag.list`
- `(admin)/admin/sessions` — prefetches `session.listAll`
- `(admin)/admin/usage` — prefetches `usage.summary`
- `(user)/chats` — prefetches `session.list`
- `(user)/flows` — prefetches `flow.listMine`

**Dynamic route pages:**
- `(admin)/admin/flows/[id]` — prefetches `flow.getCanvas({ flowId: id })`;
  `AdminFlowContent` receives `flowId` prop (removed `useParams`)
- `(user)/chats/[sessionId]` — prefetches `session.get({ sessionId })`;
  `ChatSessionContent` receives `sessionId` prop (removed `use(params)`)

## Migrations run

None — this is a pure infrastructure change with no schema impact.

## Known limitations

- Each server render calls `createServerTrpcContext()` which does one indexed
  DB key read (session lookup). Accepted per ADR 012.
- Streaming SSR / Suspense boundaries are deferred (non-goal per phase doc).
