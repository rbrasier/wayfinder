# Phase — View Knowledge from Flow Editor

- **Status**: Implemented
- **Target version**: 1.51.1 (bump: **PATCH** — UI tweak, no schema, no API surface change).
- **Builds on**: Knowledge Base Curation & Correction (v1.51.0).

## 1. Problem

The `/knowledge` curation grid is the canonical surface for an SME to inspect
the chunks a flow will retrieve. Today the only entry point is the global
sidebar link, after which the SME must remember the flow's name and pick it out
of a dropdown. From the flow editor (`/admin/flows/[id]` or
`/flows/[id]/config`) — where context docs are uploaded and the relevance
question is most live — there is no one-click route to "show me what this flow
already knows."

## 2. Approach

Add a single button to the shared `ContextDocsStrip` (used by both the admin
and the owner flow-editor canvases), placed immediately to the **left** of the
existing "Upload doc" button:

- Label: **View knowledge**
- Icon: `BookOpen` (lucide-react), matching the existing icon idiom on the page
- Behaviour: a `<Link>` (rendered through `<Button asChild>`) to
  `/knowledge?flowId=<flowId>`

Extend the `/knowledge` page (`KnowledgeContent`) to read `flowId` from the URL
query string via `useSearchParams` and seed the `flowId` state. The existing
`listQuery` / `searchQuery` already key on `flowId` and become enabled when it
is non-empty, so no other changes are needed.

The `listPublishedFlows` query backing the dropdown only includes
published-and-discoverable flows. If an author deep-links from a draft flow, the
content area still renders correctly (the queries fire on the seeded `flowId`);
the dropdown will visually show no selection. This is an acceptable trade-off
for a PATCH-scoped change and keeps the existing dropdown semantics intact.

## 3. Key files

| Layer | File | Change |
|-------|------|--------|
| web component | `apps/web/src/components/canvas/context-docs-strip.tsx` | Add `BookOpen` import, `next/link` import, render `<Button asChild>` wrapping a `<Link>` to `/knowledge?flowId=${flowId}` to the left of the upload button. |
| web page | `apps/web/src/app/(user)/knowledge/_content.tsx` | Import `useSearchParams`; seed `useState<string>(initialFlowId)` from `searchParams.get("flowId") ?? ""`. |

No domain, application, adapter, schema, router, or container changes.

## 4. Tests

- E2E (`apps/web/e2e/enhance-view-knowledge-from-flow.spec.ts`): navigate to a
  flow editor page, assert the "View knowledge" button is visible in the
  context-docs strip, click it, and assert the resulting URL is
  `/knowledge?flowId=<flowId>` and the page renders the knowledge curation
  view. The seeded flow id is then used by the existing knowledge page to
  fetch chunks — no further assertions are needed to prove the deep-link
  contract.

## 5. Out of scope / follow-up

- Showing draft / unpublished flows in the `/knowledge` dropdown (would require
  changing `listPublishedFlows` or adding an owner-scoped variant).
- Server-rendered selection state on `/knowledge` (today the seed happens
  client-side from `useSearchParams`; that is sufficient for the deep-link
  use case).
