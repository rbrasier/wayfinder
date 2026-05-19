# Phase 4 — Polish, Seed Data & Open Source Prep

- **Status**: Awaiting Implementation
- **Target version**: `1.5.0`  (bump: MINOR — new seed data + open source release artefacts)
- **PRD**: [`../prd/wayfinder.prd.md`](../prd/wayfinder.prd.md)
- **ADRs**: 011 (FSL licence); all earlier ADRs assumed
- **Depends on**: Phase 3 (v1.4.0)

## 1. Problem

After Phase 3 the product is feature-complete for MVP but rough around the
edges: no seeded flow, no empty states, no toast feedback, no docker
compose for self-hosting, no licence, no CI. Phase 4 turns Wayfinder into
something a developer can clone, run with one command, and demo end-to-end
to an agency stakeholder in under 10 minutes.

## 2. Goals

- A `pnpm db:seed` (or migration-on-first-run) populates the AU Gov
  Procurement flow: 7 nodes, 5 branches converging at Market Assessment,
  full AI instructions grounded in the Commonwealth Procurement Rules, the
  3 document templates from Phase 3, and 3 fixture context documents.
- All empty states (no sessions, no flows, no documents) are friendly.
- All data-fetching surfaces have loading skeletons.
- Error boundaries with user-friendly messages and retry actions on every
  page.
- Toast notifications for save, delete, copy link, download trigger.
- Canvas: zoom controls, minimap, fit-to-view on load.
- Chat: usable on mobile screen widths down to 360 px.
- Dark mode: respect system preference.
- README + LICENSE + `.env.example` polished for an external audience.
- Docker Compose runs the full stack (Next.js + Express API + Postgres) with
  one command.
- GitHub Actions CI pipeline (lint, type-check, test, validate.sh).

## 3. Non-goals

- No new feature work — Phase 4 is polish and ship-readiness only.
- No second seed flow (e.g. Staff Onboarding). One real example is enough
  for MVP; a second is a Phase 4.1 candidate if time allows.
- No mobile-optimised canvas — desktop-only is documented.
- No Langfuse self-hosted setup guide — the env-var-driven activation is
  already supported (ADR-002).

## 4. Key entities

| Module                                       | Lives in                                                                 | New |
| -------------------------------------------- | ------------------------------------------------------------------------ | --- |
| Procurement flow seed migration              | `packages/adapters/src/db/migrations/<timestamp>_seed_procurement.sql`   | yes |
| Procurement node + template + context fixtures | `packages/adapters/src/db/seeds/procurement/*`                         | yes |
| Empty-state components                       | `apps/web/src/components/empty-state/*`                                  | yes |
| Skeleton components                          | `apps/web/src/components/skeleton/*`                                     | yes |
| Toast wiring                                 | `apps/web/src/components/toast/*` (or shadcn `sonner`)                   | yes |
| `LICENSE` (FSL 1.1)                          | repo root                                                                | yes |
| `CONTRIBUTING.md`                            | repo root                                                                | yes |
| Updated `README.md`                          | repo root                                                                | edit |
| Updated `docker-compose.yml`                 | repo root                                                                | edit |
| Updated `.env.example`                       | repo root                                                                | edit |
| Updated `CLAUDE.md`                          | repo root                                                                | edit |
| GitHub Actions: `ci.yml`                     | `.github/workflows/ci.yml`                                               | yes |

## 5. Pages / surfaces

### Seed migration: AU Gov Procurement flow

Seven nodes (positions arranged left-to-right with the branch fan-out
vertically aligned):

1. **Identify Need** — establish scope, business case, value, timeframes.
2. **Determine Type** — categorise: Software / Hardware / Contractor /
   Services / General. **Branching node** with 5 outgoing edges.
3a. **Software Branch** — software-specific compliance (IRAP, hosting
    location, licence model).
3b. **Hardware Branch** — hardware-specific compliance (DTA standards,
    sustainability).
3c. **Contractor Branch** — labour-hire considerations, day rates,
    contractor declaration.
3d. **Services Branch** — services-specific (statement of work, KPIs).
3e. **General Branch** — generic non-categorised.
4. **Market Assessment** — receives any of the 5 branch outputs;
   reviews market, estimates value, decides between AusTender / panel /
   limited tender.
5. **Approach to Market** — `output_type='generate_document'` → **RFT
   template**.
6. **Evaluate & Select** — `output_type='generate_document'` → **Evaluation
   Report template**.
7. **Contract & AusTender** — `output_type='generate_document'` →
   **Contract Management Plan template**.

Three flow-level context fixtures (text files committed in the repo):

- `cpr-summary.md` — Commonwealth Procurement Rules summary.
- `delegation-register.md` — sample delegation register template.
- `ipp-summary.md` — Indigenous Procurement Policy summary.

Loaded into `app_flow_context_docs` as part of the seed migration.

### UI polish

- `EmptyState` component with icon + heading + body + CTA. Used on `/chats`,
  `/admin/flows`, `/admin/sessions` when lists are empty.
- `Skeleton` placeholders on all data-fetching surfaces (`/chats` list,
  `/admin/flows` list, chat message feed).
- `ErrorBoundary` at the route layout level with a "Try again" button and
  an "Open errors" link to `/admin/errors` for admins.
- Toast on: flow create / update / publish, node delete, session start,
  share copy, document download, document regenerate.

### Canvas polish

- React Flow `<MiniMap />` and `<Controls />` (zoom in/out, fit-to-view).
- "Fit-to-view" run automatically on initial load if the flow has > 3 nodes.

### Open source prep

- `README.md`: project overview, screenshots (link to mockups), stack,
  quickstart (docker-compose), configuration reference table linking to
  `.env.example`, link to FSL FAQ.
- `LICENSE`: FSL 1.1 text with future change date set to 2 years from each
  release.
- `CONTRIBUTING.md`: how to add new flow types, document templates, and
  node executors. Notes that contributions are accepted under FSL terms.
- `docker-compose.yml`: services for `web`, `api`, `postgres` (with
  pgvector). Volume mounts for `/tmp` (so generated docs survive container
  restart for short windows).
- `.env.example`: all Wayfinder env vars documented with comments.
- `CLAUDE.md`: replace template-identity language with Wayfinder identity
  ("This repo implements Wayfinder, an AI-guided workflow agent..."). Keep
  architecture rules and skill routing.
- GitHub Actions: `ci.yml` runs `pnpm install`, `pnpm typecheck`,
  `pnpm lint`, `pnpm test`, `./validate.sh` on every PR. Postgres is provided
  as a service container so `validate.sh`'s DB checks pass.

## 6. Database changes

One Drizzle migration `<timestamp>_seed_procurement.sql`:

- Inserts the procurement flow + 7 nodes + 7 edges (Identify Need →
  Determine Type → 5 branches → Market Assessment → … → Contract & AusTender).
- Inserts 3 `app_flow_context_docs` rows pointing to file paths inside the
  container.
- Idempotent: skips insert if a flow with `slug='au-gov-procurement'`
  already exists (a `slug` column may be added in Phase 4 if not present —
  treated as PATCH-compatible polish since no app reads it).

If a `slug` column is needed and was not in Phase 0, it's added here. This
is a small column add — still MINOR-compatible with the Phase 4 bump.

## 7. Acceptance criteria

- [ ] Fresh checkout: `docker-compose up`, magic-link login as
      `ADMIN_SEED_EMAIL`, navigate to `/admin/flows` → procurement flow
      appears with status `published`.
- [ ] Click the procurement flow → canvas shows 7 nodes connected with the
      branch fan-out. `/admin/sessions` shows zero sessions.
- [ ] Start a new chat from `/chats` → New Chat modal lists the procurement
      flow → start session → complete all 7 steps end-to-end → download all
      3 generated documents. End-to-end demo from fresh clone in under 10
      minutes.
- [ ] Empty states render when no data is present.
- [ ] Loading skeletons appear during initial data fetch on `/chats`,
      `/admin/flows`, `/admin/sessions`.
- [ ] Throwing an error from a test page renders the error boundary with
      "Try again" working.
- [ ] Toast appears on flow create, save, publish, session share copy,
      and document download.
- [ ] Canvas with 7 nodes auto-fits on first load; zoom controls and
      minimap work.
- [ ] Chat interface is usable on a 360 px viewport (no horizontal scroll
      on the message feed; composer reachable; step rail scrolls horizontally).
- [ ] Dark mode follows system preference and inherits shadcn tokens
      without per-component overrides.
- [ ] `README.md` quickstart works: `docker-compose up` produces a running
      app reachable at `http://localhost:3000` without further config.
- [ ] `LICENSE` file is present at repo root; README links to it.
- [ ] CI workflow runs on PR and passes for a clean main branch.
- [ ] `VERSION` and root `package.json#version` = `1.5.0`.
      `validate.sh` passes.

## 8. Build order (Claude Code session strategy)

Two sessions:

**Session 4a** — Seed data + first admin

- Procurement flow seed migration + fixture context docs.
- Three Markdown templates (RFT, Evaluation Report, Contract Management
  Plan) loaded into the right node configs.
- First admin auto-provisioned via `ADMIN_SEED_EMAIL` if not present.
- Smoke test: run the migration on a fresh DB, query `app_flow_nodes`,
  assert row count.

**Session 4b** — UI polish + open source prep

- Empty states, skeletons, error boundaries, toasts.
- Canvas MiniMap, Controls, fit-to-view.
- Mobile chat improvements.
- README, LICENSE, CONTRIBUTING, docker-compose, .env.example, CLAUDE.md
  edits.
- CI workflow.

## 9. Risks / open questions

- **Template content quality** — the AI instructions for procurement nodes
  must be grounded in CPR. Drafted by a subject-matter expert is ideal; a
  Claude-Code-generated v1 will need review by a real procurement officer
  before public release. Open question: SME availability. Default: ship v1
  with a "Templates are illustrative; consult your delegate" notice in the
  README.
- **Docker Compose Postgres data persistence** — the default compose uses a
  named volume; new contributors may not realise data persists across
  restarts. Documented in the README.
- **CI runtime cost** — running `validate.sh` (which spins up Postgres) on
  every PR adds ~2 minutes. Acceptable.
- **`slug` column add** — if it lands in Phase 4 rather than Phase 0, the
  migration order is slightly awkward. Decision: add it in Phase 4 only if
  needed; a deterministic `name`-based dedupe in the seed is simpler.

## 10. Validation

`./validate.sh` after Session 4b. Move this file to
`docs/development/implemented/v1.5.0/` and write the implementation
summary.

## 11. Post-MVP phases (not in this doc)

For completeness — these are deferred and have no phase doc yet. New
phase docs will be authored via `/new-feature` when they are scheduled:

- **Phase 5 — n8n Integration** (Auto-nodes, `N8nNodeExecutor`, SSE for
  live activity feed, approval gate UI). Target version: `1.6.0`.
- **Phase 6 — Auth Upgrade** (PKI active in deployment, SAML / Entra ID
  group mapping to admin/user roles, session timeout, audit log).
  Target version: `1.7.0`.

These exist in the PRD §11 "Out of scope / future work" and will be
fleshed out when planning begins.
