# Phase 4 Implementation Summary — v1.5.0

**Version bump**: MINOR (1.4.0 → 1.5.0) — new infra service (MinIO), new use case (OverrideBranch), open source release artefacts.

---

## What was built

### Persistent object storage (MinIO)

- **`IObjectStorage` port** (`packages/domain/src/ports/object-storage.ts`) — `put / get / delete / exists / initialise` using the Result pattern.
- **`MinioStorageAdapter`** (`packages/adapters/src/storage/minio-storage.ts`) — implements `IObjectStorage` via the `minio` npm client. Supports `pathStyle` for S3 compatibility. `initialise()` creates the bucket on first run.
- **`minio-storage.test.ts`** — 10 unit tests covering all operations including error paths (NoSuchKey, network failure).
- **`GenerateDocument` use case** updated to use `IObjectStorage` instead of `IDocumentStorage`. Template reads via `objectStorage.get(key)`, generated DOCX stored via `objectStorage.put(key, bytes, mimeType)`.
- **API route handlers** updated to use `objectStorage` from container instead of direct `fs` calls:
  - `api/flows/[id]/nodes/[nodeId]/template/route.ts` — stores templates under `templates/<nodeId>/<timestamp>-<filename>`
  - `api/flows/[id]/context-docs/route.ts` — stores context docs under `context/<flowId>/<timestamp>-<filename>`
  - `api/documents/[documentId]/route.ts` — reads generated DOCX from `generated/<sessionId>/<filename>`
- **Container** (`apps/web/src/lib/container.ts`) — `MinioStorageAdapter` wired in place of `LocalDocumentStorage`; `objectStorage` exposed on the container for route handler use.
- **Env** (`apps/web/src/lib/env.ts`) — `MINIO_ENDPOINT`, `MINIO_PORT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_BUCKET`, `MINIO_USE_SSL` added.

### Infrastructure

- **`docker-compose.yml`** — added `storage` (MinIO) service with named `minio-data` volume; renamed containers from `template-*` to `wayfinder-*`; updated `POSTGRES_DB` to `wayfinder`.
- **`.env.example`** — added `MINIO_*` vars with documentation; updated `APP_NAME`, `DATABASE_URL`, `OTEL_SERVICE_NAME` to Wayfinder identity.
- **`restart.sh`** — added MinIO readiness poll (15 × 2 s) when `MINIO_ENDPOINT`/`MINIO_PORT` are set; exits with clear message if unreachable.

### UI polish

- **`EmptyState` component** (`apps/web/src/components/empty-state/index.tsx`) — icon + heading + body + optional CTA button. Used on `/chats`, `/admin/flows`, `/admin/sessions`.
- **Skeleton components** (`apps/web/src/components/skeleton/card-skeleton.tsx`) — `CardSkeleton`, `CardSkeletonGrid`, `TableRowSkeleton`, `TableSkeletonRows`. Used on `/chats`, `/admin/flows`, `/admin/sessions`.
- **Toast** — added `sonner` to `@wayfinder/web`; `<Toaster>` wired in root layout. Toasts on: flow create, publish/unpublish, branch override success, document regenerate.
- **Canvas** — added `<Controls />`, `<MiniMap />`, and auto-`fitView` on initial load when flow has > 3 nodes. Wrapped with `ReactFlowProvider` for `useReactFlow` hook access.

### Branch-override modal

- **`OverrideBranch` use case** (`packages/application/src/use-cases/session/override-branch.ts`) — validates the target is a valid outgoing edge from the current node, then updates `session.currentNodeId`.
- **`session.overrideBranch` tRPC mutation** in `apps/web/src/server/routers/session.ts`.
- **`BranchOverrideModal`** component (`apps/web/src/components/chat/branch-override-modal.tsx`) — lists outgoing branches; fires `overrideBranch` on confirm.
- **Session chat page** — detects ≥ 3 high-confidence assistant messages on the current node without advancement (proxy for consecutive null branchChoice). Admin-only override affordance shown; non-admins see no affordance.
- **`user.me` tRPC query** added to `user` router — returns `{ userId, isAdmin }` for authenticated users.

### Open source prep

- **`README.md`** — rewritten for Wayfinder: quickstart, stack table, architecture overview, configuration reference, licence link.
- **`LICENSE`** — FSL 1.1 with Apache 2.0 change licence.
- **`CONTRIBUTING.md`** — how to add node executors, document templates, domain ports; commit style; code style summary.
- **`CLAUDE.md`** — Project Identity section updated from template-scaffold language to Wayfinder identity.
- **`.github/workflows/ci.yml`** — added Postgres and MinIO service containers; added `./validate.sh` step.
- **`docs/guides/setup-local.md`** — prerequisites, clone, env config, DB creation, MinIO local setup, `pnpm dev`, first login, troubleshooting table.
- **`docs/guides/setup-railway.md`** — Railway project creation, required services, env var mapping table, deploy, first login, verification.

---

## Files created

| File | Purpose |
|---|---|
| `packages/domain/src/ports/object-storage.ts` | `IObjectStorage` port |
| `packages/adapters/src/storage/minio-storage.ts` | MinIO adapter |
| `packages/adapters/src/storage/minio-storage.test.ts` | Adapter unit tests |
| `packages/application/src/use-cases/session/override-branch.ts` | Branch override use case |
| `apps/web/src/components/empty-state/index.tsx` | EmptyState component |
| `apps/web/src/components/skeleton/card-skeleton.tsx` | Skeleton components |
| `apps/web/src/components/chat/branch-override-modal.tsx` | Branch override modal |
| `LICENSE` | FSL 1.1 |
| `CONTRIBUTING.md` | Contributor guide |
| `docs/guides/setup-local.md` | Local dev guide |
| `docs/guides/setup-railway.md` | Railway deploy guide |

---

## Known limitations

- The `OverrideBranch` stall detection in the UI is a heuristic (counts high-confidence assistant messages on the current node). It does not distinguish between a stall caused by null branchChoice vs. a node that legitimately required multiple turns before advancing. A future phase could store branchChoice in the message record.
- MinIO on first Docker Compose startup may take a few seconds before the health check passes; the API's `initialise()` call retries gracefully via the minio client's built-in retry logic.
- Mobile chat layout (360 px) was improved via `min-w-0` / `shrink-0` classes on the header; full responsive audit of the step rail is deferred.
