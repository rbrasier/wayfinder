# Phase 4 — Polish, Persistent Storage & Open Source Prep

- **Status**: Awaiting Implementation
- **Target version**: `1.5.0`  (bump: MINOR — new infra service + open source release artefacts)
- **PRD**: [`../prd/wayfinder.prd.md`](../prd/wayfinder.prd.md)
- **ADRs**: 009 (IObjectStorage / MinIO); 011 (FSL licence); all earlier ADRs assumed
- **Depends on**: Phase 3 (v1.4.0)
- **Mockups**: [`../mockups/FlowAgent.html`](../mockups/FlowAgent.html), [`../mockups/FlowAgent Chat.html`](<../mockups/FlowAgent Chat.html>), [`../mockups/FlowAgent Configure.html`](<../mockups/FlowAgent Configure.html>) — all three; Phase 4 polishes every surface to match the mockups exactly

## 1. Problem

After Phase 3 the product is feature-complete for MVP but has two rough edges:

1. **Ephemeral file storage** — uploaded templates and generated documents
   live under `DOCUMENT_STORAGE_PATH` on the API container's local disk.
   Files survive container restarts only if the directory is volume-mounted.
   This is a documented limitation throughout Phases 1–3; Phase 4 resolves it
   with a proper object storage layer backed by MinIO.
2. **Developer experience** — no docker-compose one-liner, no licence, no CI,
   rough empty states and loading feedback. Phase 4 turns Wayfinder into
   something a developer can clone, run with one command, and demo end-to-end
   to an agency stakeholder in under 10 minutes.

Fresh installs have **no seed flow** — admins create flows from scratch.
The quickstart path is: install → log in → create a flow → add nodes →
upload a document template → start a chat → complete a step → download the
generated document.

## 2. Goals

- **Persistent storage**: all uploaded files (context docs, node templates)
  and generated documents are stored in MinIO via an `IObjectStorage` port.
  Files survive container restarts without manual volume configuration.
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
- Docker Compose runs the full stack (Next.js + Express API + Postgres +
  MinIO) with one command.
- GitHub Actions CI pipeline (lint, type-check, test, validate.sh).

## 3. Non-goals

- No new feature work — Phase 4 is storage migration, polish, and
  ship-readiness only.
- No seeded AU Gov Procurement flow — the example `.docx` templates in
  `docs/templates/` are committed in Phase 3; a flow owner creates and
  configures the procurement flow manually via the admin canvas. This keeps
  seed data under human review before any public demo.
- No mobile-optimised canvas — desktop-only is documented.
- No Langfuse self-hosted setup guide — the env-var-driven activation is
  already supported (ADR-002).

## 4. Key entities

| Module                                       | Lives in                                                                 | New |
| -------------------------------------------- | ------------------------------------------------------------------------ | --- |
| `IObjectStorage` port                        | `packages/domain/src/ports/object-storage.ts`                           | yes |
| `MinioStorageAdapter`                        | `packages/adapters/src/storage/minio-storage.ts`                        | yes |
| MinIO service in docker-compose              | `docker-compose.yml`                                                     | edit |
| `LocalDocumentStorageAdapter` → replaced     | `packages/adapters/src/storage/local-document-storage.ts`               | edit (wired to MinIO) |
| `MINIO_*` env vars                           | `.env.example`                                                           | edit |
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

### Persistent storage: IObjectStorage + MinIO

The `IObjectStorage` port lives in `packages/domain/src/ports/object-storage.ts`:

```ts
interface IObjectStorage {
  put(key: string, data: Buffer, mimeType: string): Promise<{ key: string }>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
```

`MinioStorageAdapter` in `packages/adapters/src/storage/minio-storage.ts`
implements this port using the `minio` npm client. All existing callers of
`LocalDocumentStorageAdapter` are updated to depend on the `IObjectStorage`
port; `MinioStorageAdapter` is injected via `lib/container.ts`.

MinIO is added to `docker-compose.yml` as the `storage` service:

```yaml
storage:
  image: minio/minio:latest
  command: server /data --console-address ":9001"
  environment:
    MINIO_ROOT_USER: ${MINIO_ROOT_USER}
    MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD}
  ports:
    - "9000:9000"
    - "9001:9001"
  volumes:
    - minio_data:/data
```

A startup script (or `MINIO_DEFAULT_BUCKETS` env) creates the
`wayfinder-documents` bucket on first run.

`.env.example` gains:

```
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=wayfinder-documents
MINIO_USE_SSL=false
```

For production deployments targeting AWS S3, the same env vars are used
with `MINIO_ENDPOINT=s3.amazonaws.com` and `MINIO_USE_SSL=true` — no code
change needed, just adapter re-use.

Object key scheme (preserves the Phase 3 path structure):

- `templates/<nodeId>/<timestamp>-<filename>` — uploaded node templates
- `context/<flowId>/<timestamp>-<filename>` — flow context documents
- `generated/<sessionId>/<filename>` — AI-generated DOCX outputs

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

- `README.md`: project overview, screenshots (link to mockups), stack,
  quickstart (docker-compose up), configuration reference table linking to
  `.env.example`, link to FSL FAQ. Notes that example templates in
  `docs/templates/` can be uploaded via the admin canvas.
- `LICENSE`: FSL 1.1 text with future change date set to 2 years from each
  release.
- `CONTRIBUTING.md`: how to add new flow types, document templates, and
  node executors. Notes that contributions are accepted under FSL terms.
- `docker-compose.yml`: services for `web`, `api`, `postgres` (with
  pgvector), `minio`. Named volumes for Postgres and MinIO data.
- `.env.example`: all Wayfinder env vars documented with comments, including
  MinIO vars and `DOCUMENT_STORAGE_PATH` (kept as fallback for local dev
  without MinIO).
- `CLAUDE.md`: replace template-identity language with Wayfinder identity
  ("This repo implements Wayfinder, an AI-guided workflow agent..."). Keep
  architecture rules and skill routing.
- GitHub Actions: `ci.yml` runs `pnpm install`, `pnpm typecheck`,
  `pnpm lint`, `pnpm test`, `./validate.sh` on every PR. Postgres and MinIO
  are provided as service containers so all checks pass.

## 6. Database changes

None. All Phase 4 changes are infra, adapters, and UI. The `storage_path`
columns in `app_documents` and `app_flow_context_docs` now hold MinIO object
keys rather than local filesystem paths — this is a data-format change for
new rows only; existing rows (none in a fresh install) retain whatever path
they were written with.

## 7. Acceptance criteria

- [ ] `docker-compose up` starts `web`, `api`, `postgres`, and `minio` in
      one command. MinIO console is reachable at `http://localhost:9001`.
      `wayfinder-documents` bucket is created automatically.
- [ ] Uploading a context document on the canvas stores it in MinIO
      (visible in the MinIO console under `context/<flowId>/...`). Restarting
      all containers (`docker-compose restart`) and reloading the canvas
      shows the document still listed.
- [ ] Uploading a `.docx` template via the node config modal stores it in
      MinIO (`templates/<nodeId>/...`). Template survives container restart.
- [ ] Completing a document-generating step stores the output in MinIO
      (`generated/<sessionId>/...`). Downloading after a container restart
      succeeds (no 410 unless the object was explicitly deleted).
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
- [ ] Canvas with multiple nodes auto-fits on first load; zoom controls and
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

**Session 4a** — Persistent storage (MinIO)

- `IObjectStorage` port in `packages/domain`.
- `MinioStorageAdapter` in `packages/adapters` with unit tests (using a
  test MinIO instance or mocked client).
- Wire `MinioStorageAdapter` into `lib/container.ts`, replacing
  `LocalDocumentStorageAdapter` for all storage calls.
- Update `docker-compose.yml` with the `minio` service + named volume.
- Update `.env.example` with MinIO vars.
- Smoke test: run docker-compose up, upload a context doc, restart
  containers, verify the file is still accessible.

**Session 4b** — UI polish + open source prep

- First-admin seed via `ADMIN_SEED_EMAIL`.
- Empty states, skeletons, error boundaries, toasts.
- Branch-override modal (admin-only).
- Canvas MiniMap, Controls, fit-to-view.
- Mobile chat improvements.
- README, LICENSE, CONTRIBUTING, docker-compose (finalise), .env.example,
  CLAUDE.md edits.
- CI workflow.

## 9. Risks / open questions

- **MinIO bucket init on first run** — `minio/minio` does not auto-create
  buckets. Options: (a) a `mc` init container in docker-compose that creates
  the bucket and exits, (b) the API creates the bucket on startup if absent
  via the MinIO client. Option (b) is simpler and avoids an extra compose
  service. Default: use the SDK `makeBucket` call in the adapter's
  `initialise()` method, called from `container.ts` on startup.
- **S3 compatibility in production** — `MinioStorageAdapter` targets the
  S3-compatible MinIO API; real AWS S3 uses the same protocol but may require
  path-style vs. virtual-hosted-style URL differences. The adapter should
  expose a `forcePathStyle` config option. Add this from day one to avoid a
  Phase 5 breaking change.
- **CI MinIO service container** — GitHub Actions `services` for MinIO are
  straightforward but the health-check timing needs care. Use
  `minio/minio:latest` with a `curl` health probe before `validate.sh` runs.
- **Existing local dev without MinIO** — developers who have been running
  Phases 1–3 without docker-compose will need to start MinIO locally or
  set `MINIO_*` vars to a remote instance. Document this clearly in the
  README migration note.

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
