# Phase 4 — Polish & Open Source Prep

- **Status**: Awaiting Implementation
- **Target version**: `1.5.0`  (bump: MINOR — open source release artefacts + polish)
- **PRD**: [`../prd/wayfinder.prd.md`](../prd/wayfinder.prd.md)
- **ADRs**: 011 (FSL licence); all earlier ADRs assumed
- **Depends on**: Phase 3 (v1.4.0)
- **Mockups**: [`../mockups/FlowAgent.html`](../mockups/FlowAgent.html), [`../mockups/FlowAgent Chat.html`](<../mockups/FlowAgent Chat.html>), [`../mockups/FlowAgent Configure.html`](<../mockups/FlowAgent Configure.html>) — all three; Phase 4 polishes every surface to match the mockups exactly

## 1. Problem

After Phase 3 the product is feature-complete for MVP but rough around the
edges: no empty states, no toast feedback, no docker compose for self-hosting,
no licence, no CI, and some edge cases left unpolished. Phase 4 turns
Wayfinder into something a developer can clone, run with one command, and
demo to a stakeholder starting from an empty install.

Fresh installs have **no seed flow** — admins create flows from scratch.
The quickstart path is: install → log in → create a flow → add nodes →
upload a document template → start a chat → complete a step → download the
generated document.

## 2. Goals

- All empty states (no sessions, no flows, no documents) are friendly and
  guide the user to their next action.
- All data-fetching surfaces have loading skeletons.
- Error boundaries with user-friendly messages and retry actions on every
  page.
- Toast notifications for save, delete, copy link, download trigger.
- Canvas: zoom controls, minimap, fit-to-view on load.
- Admin-only "Pick a branch manually?" override after three consecutive null
  `branchChoice` returns on a branching node.
- Chat: usable on mobile screen widths down to 360 px.
- Dark mode: respect system preference.
- First admin auto-provisioned via `ADMIN_SEED_EMAIL` if not present (ensures
  a fresh `docker-compose up` is immediately accessible).
- README + LICENSE + `.env.example` polished for an external audience.
- Docker Compose runs the full stack (Next.js + Express API + Postgres) with
  one command.
- GitHub Actions CI pipeline (lint, type-check, test, validate.sh).

## 3. Non-goals

- No seed flows — empty install. Flow creation is an admin task, not a demo
  fixture.
- No new feature work — Phase 4 is polish and ship-readiness only.
- No mobile-optimised canvas — desktop-only is documented.
- No Langfuse self-hosted setup guide — the env-var-driven activation is
  already supported (ADR-002).

## 4. Key entities

| Module                                       | Lives in                                                                 | New |
| -------------------------------------------- | ------------------------------------------------------------------------ | --- |
| First-admin seed (via `ADMIN_SEED_EMAIL`)     | `packages/adapters/src/db/seeds/admin-seed.ts`                          | yes |
| Empty-state components                       | `apps/web/src/components/empty-state/*`                                  | yes |
| Skeleton components                          | `apps/web/src/components/skeleton/*`                                     | yes |
| Toast wiring                                 | `apps/web/src/components/toast/*` (or shadcn `sonner`)                   | yes |
| Branch-override modal                        | `apps/web/src/components/chat/branch-override-modal.tsx`                 | yes |
| `LICENSE` (FSL 1.1)                          | repo root                                                                | yes |
| `CONTRIBUTING.md`                            | repo root                                                                | yes |
| Updated `README.md`                          | repo root                                                                | edit |
| Updated `docker-compose.yml`                 | repo root                                                                | edit |
| Updated `.env.example`                       | repo root                                                                | edit |
| Updated `CLAUDE.md`                          | repo root                                                                | edit |
| GitHub Actions: `ci.yml`                     | `.github/workflows/ci.yml`                                               | yes |

## 5. Pages / surfaces

> **Mockup references** (polish target — all surfaces should match by end of Phase 4):
> - [`../mockups/FlowAgent.html`](../mockups/FlowAgent.html) — My Chats (empty states, skeletons, session cards)
> - [`../mockups/FlowAgent Chat.html`](<../mockups/FlowAgent Chat.html>) — Chat (mobile layout, document card, milestone pill polish)
> - [`../mockups/FlowAgent Configure.html`](<../mockups/FlowAgent Configure.html>) — Configure (minimap, controls, empty canvas state)

### First-admin provisioning

On startup (or as part of `pnpm db:seed`), if no user with `is_admin = true`
exists in `core_users` and `ADMIN_SEED_EMAIL` is set, create that user with
a magic-link login. This ensures `docker-compose up` produces an immediately
usable app.

### UI polish

- `EmptyState` component with icon + heading + body + CTA. Used on `/chats`,
  `/admin/flows`, `/admin/sessions` when lists are empty, with contextual
  guidance ("Create your first flow" on `/admin/flows`, "Start a new chat"
  on `/chats`).
- `Skeleton` placeholders on all data-fetching surfaces.
- `ErrorBoundary` at the route layout level with a "Try again" button and an
  "Open errors" link to `/admin/errors` for admins.
- Toast on: flow create / update / publish, node delete, session start,
  share copy, document download, document regenerate.

### Canvas polish

- React Flow `<MiniMap />` and `<Controls />` (zoom in/out, fit-to-view).
- "Fit-to-view" run automatically on initial load if the flow has > 3 nodes.

### Branch override modal

When a branching node returns `branchChoice: null` three consecutive times:

- A system message appears in the chat feed: "Wayfinder could not determine
  the next step."
- Admins see a "Pick a step manually" button below the system message.
- Clicking it opens a modal listing the outgoing branches by node name.
- Selecting a branch calls `session.overrideBranch({ sessionId, targetNodeId })`
  and resumes the session from that node.
- Non-admins see only the system message with no override affordance.

### Open source prep

- `README.md`: project overview, stack, quickstart (docker-compose),
  configuration reference table, link to FSL FAQ. Quickstart path:
  `docker-compose up` → log in as admin → create a flow → start a chat.
- `LICENSE`: FSL 1.1 with future change date set to 2 years from release.
- `CONTRIBUTING.md`: how to add new node types, document templates, and
  node executors. Notes contributions are accepted under FSL terms.
- `docker-compose.yml`: services for `web`, `api`, `postgres` (with
  pgvector). Volume mounts for `/tmp` (so generated docs survive container
  restart for short windows).
- `.env.example`: all env vars documented with comments.
- `CLAUDE.md`: replace template-identity language with Wayfinder identity.
- GitHub Actions: `ci.yml` runs `pnpm install`, `pnpm typecheck`,
  `pnpm lint`, `pnpm test`, `./validate.sh` on every PR. Postgres is a
  service container so `validate.sh`'s DB checks pass.

## 6. Database changes

None beyond Phase 0 schema. The first-admin seed uses DML (`INSERT` if not
exists) rather than a migration.

## 7. Acceptance criteria

- [ ] Fresh checkout: `docker-compose up`, magic-link login as
      `ADMIN_SEED_EMAIL`, navigate to `/admin/flows` → empty state with
      "Create your first flow" CTA.
- [ ] Create a flow, add a single `generate_document` node with a `.docx`
      template, start a chat, complete the step, download the DOCX — all from
      a fresh clone in under 10 minutes.
- [ ] Empty states render when no data is present on `/chats`,
      `/admin/flows`, and `/admin/sessions`.
- [ ] Loading skeletons appear during initial data fetch on `/chats`,
      `/admin/flows`, `/admin/sessions`.
- [ ] Throwing an error from a test page renders the error boundary with
      "Try again" working.
- [ ] Toast appears on flow create, save, publish, session share copy,
      and document download.
- [ ] On a branching node that returns `branchChoice: null` three consecutive
      times, an admin sees a "Pick a branch manually?" affordance; selecting
      a branch advances the session to that node.
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

**Session 4a** — First admin + UI polish

- First-admin seed via `ADMIN_SEED_EMAIL`.
- Empty states, skeletons, error boundaries, toasts.
- Branch-override modal (admin-only).

**Session 4b** — Open source prep

- Canvas MiniMap, Controls, fit-to-view.
- Mobile chat improvements.
- README, LICENSE, CONTRIBUTING, docker-compose, .env.example, CLAUDE.md
  edits.
- CI workflow.

## 9. Risks / open questions

- **Docker Compose Postgres data persistence** — the default compose uses a
  named volume; new contributors may not realise data persists across
  restarts. Documented in the README.
- **CI runtime cost** — running `validate.sh` (which spins up Postgres) on
  every PR adds ~2 minutes. Acceptable.

## 10. Validation

`./validate.sh` after Session 4b. Move this file to
`docs/development/implemented/v1.5.0/` and write the implementation summary.

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
