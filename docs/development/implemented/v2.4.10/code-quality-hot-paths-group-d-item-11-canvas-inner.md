# v2.4.10 — Group D item 11: `CanvasInner` decomposition (empties the size allowlist)

**Phase**: "Code Quality: Hot Paths, Boundaries, and Decomposition",
**Group D** (frontend/file decomposition), item 11 — the deeper `CanvasInner`
split deferred by v2.4.3. **Bump**: PATCH (2.4.9 → 2.4.10). No schema change, no
behaviour change; a structural decomposition of the two flow-config canvas
files, plus emptying the `validate.sh` legacy size allowlist.

This is the **final slice of the phase** — with it, the allowlist is empty and
every phase acceptance criterion is met. See the phase doc (now at
`implemented/v2.4.10/code-quality-hot-paths-and-decomposition.phase.md`) for the
close-out summary and the three items consciously carried forward.

## Problem

The two flow-config canvases —
`app/(user)/flows/[id]/config/_content.tsx` (861 lines) and
`app/(admin)/admin/flows/[id]/_content.tsx` (850 lines) — were the last two
entries on `validate.sh`'s `SIZE_LEGACY_ALLOWLIST` above the 800-line fail line.
v2.4.3 took the safe verbatim win (shared React Flow adapters → `rf-adapters.ts`,
~85 lines each) and explicitly deferred the deeper split because it "invents new
prop boundaries the automated tests do not cover." That deeper split is this
slice.

## Change

Each file's two largest self-contained JSX regions were extracted:

- **Shared** `components/canvas/flow-canvas-viewport.tsx` (new): the React Flow
  pane (`<ReactFlow>` + `Background`/`Controls`/`MiniMap`) and the
  stale-reference banner, which were byte-identical between the two files (modulo
  Tailwind class ordering). Takes `nodes`, `edges`, the six canvas handlers, and
  `staleReferences`. This is the "shared flow-config section" item 11 called for;
  the remaining logic (state, mutations, memos) stays per-file because the two
  screens diverge (the user screen has metadata/delete dialogs, `canPublishTo­
  Everyone`, `orderStepIds`; the admin screen has an inline rename, a publish
  sub-menu, and `computeStepNumbers`).
- **Per-file** `_flow-config-header.tsx` (new, one beside each `_content.tsx`):
  the header bar + flow-actions menu — the biggest and most divergent block
  (~168 lines user, ~212 admin). Presentational: every mutation and piece of
  canvas state is threaded in as an explicit prop, so the publish / visibility /
  version-history / delete / rename actions keep their exact prior behaviour.
  `updateFlowMutation` is passed as a whole (`ReturnType<typeof
  trpc.flow.update.useMutation>`) and `versionStatusQuery.refetch` as a
  `refetchVersionStatus` callback, so each menu item's `onClick` moved verbatim.

`CanvasInner` in both files keeps all state, effects, mutations, handlers, and
memos, and now renders `<FlowConfigHeader …/>` + `<FlowCanvasViewport …/>` in
place of the inlined JSX.

## Result

| File | Before | After |
|---|---|---|
| `(user)/flows/[id]/config/_content.tsx` | 861 | **693** |
| `(admin)/admin/flows/[id]/_content.tsx` | 850 | **640** |
| `components/canvas/flow-canvas-viewport.tsx` | — | 69 (new, shared) |
| `(user)/…/_flow-config-header.tsx` | — | 230 (new) |
| `(admin)/…/_flow-config-header.tsx` | — | 282 (new) |

Both `_content.tsx` files drop under 700 (off the WARN band as well as the fail
line). With `node-config-modal.tsx` (675, v2.4.2) and `turn-helpers.ts` (749)
already below 800, all four former allowlist entries now clear the fail line, so
`SIZE_LEGACY_ALLOWLIST` in `validate.sh` is set to **empty** — the ratchet
enforces the 800-line limit with no grandfathered exceptions. `field-report-
section.tsx` (732), `turn-helpers.ts` (749) and `container.ts` (727) remain in
the advisory WARN band (items 12–13 + the container), none on the allowlist.

## Files changed

- `apps/web/src/components/canvas/flow-canvas-viewport.tsx` (new, shared).
- `apps/web/src/app/(user)/flows/[id]/config/_flow-config-header.tsx` (new).
- `apps/web/src/app/(user)/flows/[id]/config/_content.tsx` — imports + two JSX
  regions replaced by the extracted components.
- `apps/web/src/app/(admin)/admin/flows/[id]/_flow-config-header.tsx` (new).
- `apps/web/src/app/(admin)/admin/flows/[id]/_content.tsx` — same.
- `validate.sh` — `SIZE_LEGACY_ALLOWLIST` emptied.
- Phase doc moved to `implemented/v2.4.10/` with Group A/B/D progress notes,
  the phase-complete banner, and acceptance criteria marked met.
- `VERSION`, `package.json` — 2.4.9 → 2.4.10.

## Migrations run

None.

## Tests

- No new unit tests: the two canvas files are client components that need a DOM
  + React Flow provider + tRPC context and carry **no** existing unit tests; the
  extraction is a verbatim JSX move with explicit typed props. The safety net is
  the compiler (the prop wiring is fully type-checked) plus the browser check
  below — the same posture v2.4.2 took for the `node-config-modal` split.
- `pnpm --filter @wayfinder/web exec tsc --noEmit`: clean.
- `./validate.sh`: 19/19 PASS, including the size check with the now-empty
  allowlist.

## Verification still owed (needs a browser — see handoff)

The header extraction invents new prop boundaries `tsc` proves are wired but
cannot prove behave. Before shipping, click through both flow-config screens and
confirm: header actions menu (user: publish privately/globally, make
global/private, unpublish, publish new version, edit metadata, version history,
delete), admin publish sub-menu + inline rename (Enter saves, Escape reverts to
the server name), Add step, the outside-click that closes each menu, node
click/drag/connect on the shared viewport, and the stale-reference banner.
