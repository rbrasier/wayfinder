# Implementation Summary — View Knowledge from Flow Editor (v1.51.1)

- **Version bump**: PATCH (1.51.0 → 1.51.1) — UI tweak, no schema, no API surface change.
- **Phase**: `docs/development/implemented/v1.51.1/view-knowledge-from-flow.phase.md`

## What was built

A one-click route from a flow's editor to its slice of the `/knowledge`
curation grid. A **View knowledge** button (BookOpen icon) now sits immediately
to the left of "Upload doc" in the context-docs strip, on both
`/admin/flows/[id]` and `/flows/[id]/config`. Clicking it opens
`/knowledge?flowId=<flowId>`, and the knowledge page seeds its flow dropdown
from that query parameter — so the SME lands directly on the chunks for the
flow they were just editing.

## How it works

- `ContextDocsStrip` (shared by both editor variants) renders a
  `<Button asChild>` wrapping a `<Link>` to `/knowledge?flowId=${flowId}`,
  with the `BookOpen` icon from `lucide-react`.
- `KnowledgeContent` reads `flowId` from `useSearchParams()` and uses it as
  the initial value of the `flowId` state. The existing list / search queries
  key on that state and become enabled when it is non-empty, so no other
  changes are needed.
- The `listPublishedFlows` query backing the dropdown only includes
  published-and-discoverable flows. Deep-linking from a draft flow still
  renders the correct knowledge content (the queries fire on the seeded
  `flowId`) but the dropdown visually shows no selection — acceptable for
  PATCH scope.

## Files modified

- `apps/web/src/components/canvas/context-docs-strip.tsx` — `BookOpen` + `Link` imports, new button to the left of "Upload doc".
- `apps/web/src/app/(user)/knowledge/_content.tsx` — `useSearchParams` import, seed `useState<string>` from `searchParams.get("flowId") ?? ""`.
- `VERSION`, `package.json` — bumped to `1.51.1`.

## Out of scope / follow-up

- Including draft / unpublished flows in the `/knowledge` dropdown when
  deep-linked.
- An e2e Playwright test for this enhancement was explicitly skipped at the
  user's request; `./validate.sh` (unit + coverage) covers correctness of the
  surrounding code.
