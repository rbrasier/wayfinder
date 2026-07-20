# /e2e-cc-web — Bootstrap & Run Playwright E2E in the Claude Code Web Sandbox

Use this skill to run the Playwright e2e suite from **inside a Claude Code web
container**, where there is **no database, no app server, and no browser**, and
where the Playwright/Chrome download CDNs are blocked (403). This is the
"stand everything up from nothing" recipe.

> Difference from `/e2e`: `/e2e` assumes the dev server and a Playwright browser
> are already available and drives tests via the MCP connector. `/e2e-cc-web`
> provisions Postgres, the app server, and a Chromium binary first, then runs
> the suite via the CLI. Reach for this one in a fresh web session.

---

## Environment constraints (why this recipe exists)

- The CI workflow (`.github/workflows/e2e.yml`) only runs against `main`.
- The web container starts with no DB, no app server, no browser.
- Outbound network is restricted: the **npm registry and Ubuntu apt mirrors are
  reachable**, but the **Playwright/Chrome download CDNs return 403**, so
  `npx playwright install` fails. We sidestep this with `@sparticuz/chromium`,
  which ships a headless Chromium inside its npm tarball.
- MinIO has no apt package and its release CDN (`dl.min.io`) is blocked (403),
  so object storage is provided by **`s3rver`** — a pure-JS S3-compatible server
  installed from the npm registry. The app's `MinioStorageAdapter` talks plain
  S3 (path-style), so `s3rver` is a drop-in. This unblocks the upload/RAG specs
  (`phase-rag-with-pgvector`, `enhance-reindex-documents`) that the CI job skips.

---

## 1. Postgres (with pgvector), run locally as the `ubuntu` user

```bash
# pgvector isn't preinstalled; the apt mirror has it
apt-get install -y postgresql-16-pgvector

# Postgres refuses to run as root → run the cluster as the `ubuntu` user,
# and use a writable socket dir (/var/run/postgresql is root-owned)
PGBIN=/usr/lib/postgresql/16/bin
rm -rf /tmp/pgdata && mkdir -p /tmp/pgdata /tmp/pgsock
chown ubuntu:ubuntu /tmp/pgdata /tmp/pgsock
su ubuntu -c "$PGBIN/initdb -D /tmp/pgdata -U postgres --auth=trust"
su ubuntu -c "$PGBIN/pg_ctl -D /tmp/pgdata -o '-p 5432 -k /tmp/pgsock' -l /tmp/pg.log start"

PGPASSWORD=postgres psql -h localhost -U postgres -c "CREATE DATABASE wayfinder_e2e;"
PGPASSWORD=postgres psql -h localhost -U postgres -d wayfinder_e2e -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

---

## 2. Object storage (S3) for the upload/RAG specs — `s3rver`

Run this **before** the app so storage init succeeds on first boot. `s3rver`
validates AWS access keys; its **default credentials are `S3RVER` / `S3RVER`**
(NOT `minioadmin`), so the app's `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` must be
set to match (see step 3). Pre-create the bucket the app expects.

```bash
mkdir -p /tmp/s3srv && cd /tmp/s3srv && npm init -y && npm install s3rver@3.7.1
cat > /tmp/s3srv/run.js <<'EOF'
const S3rver = require('s3rver');
const fs = require('fs');
fs.rmSync('/tmp/s3-data', { recursive: true, force: true });
fs.mkdirSync('/tmp/s3-data', { recursive: true });
new S3rver({
  port: 9000, address: '0.0.0.0', silent: false, directory: '/tmp/s3-data',
  configureBuckets: [{ name: 'wayfinder-documents', configs: [] }],
}).run((err, o) => err ? (console.error(err), process.exit(1))
                       : console.log(`S3RVER_READY ${o.address}:${o.port}`));
EOF
nohup node /tmp/s3srv/run.js >/tmp/s3rver.log 2>&1 &
# probe: curl -s -o /dev/null -w '%{http_code}\n' http://localhost:9000/  → 200
```

> Skip this only if you are running the narrow admin/flow/scheduling subset; the
> full suite needs it (otherwise `phase-rag-with-pgvector` fails with a 500
> `{"error":"Failed to store document"}`).

---

## 3. Install deps, migrate, start the app

The env mirrors `.github/workflows/e2e.yml`, plus the `MINIO_*` overrides that
point the app at `s3rver` with its default `S3RVER`/`S3RVER` credentials. The
`MinioStorageAdapter` resolves its client lazily, so the app can start before or
after `s3rver`, but starting storage first keeps the boot log clean.

```bash
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/wayfinder_e2e
export BETTER_AUTH_SECRET=e2e-test-secret-must-be-at-least-32-chars-long
export BETTER_AUTH_URL=http://localhost:3000
export AI_DEFAULT_PROVIDER=anthropic
export ADMIN_SEED_EMAIL=admin@example.com
export TEST_AUTH_BYPASS=true
export TEST_ADMIN_EMAIL=admin@example.com
export USE_REAL_AI=false              # specs mock AI via apps/web/e2e/helpers/base.ts
export BASE_URL=http://localhost:3000

# Point object storage at the local s3rver (step 2). Endpoint/port/bucket match
# the app's env defaults; only the credentials differ from minioadmin.
export MINIO_ENDPOINT=localhost MINIO_PORT=9000 MINIO_USE_SSL=false
export MINIO_ACCESS_KEY=S3RVER MINIO_SECRET_KEY=S3RVER MINIO_BUCKET=wayfinder-documents

# Tells the suite a storage backend exists, so the storage-writing spec
# (phase-rag-with-pgvector) runs instead of skipping. Must be visible to the
# `npx playwright test` shell in step 5, so keep it exported there too.
export E2E_OBJECT_STORAGE=1

pnpm install --frozen-lockfile
pnpm db:migrate
nohup pnpm --filter @wayfinder/web dev >/tmp/web.log 2>&1 &
# wait until http://localhost:3000 answers (307 redirect to /login is fine)
```

---

## 4. A Chromium that doesn't need the blocked CDN

`@sparticuz/chromium` ships a real headless Chromium **inside its npm tarball**,
so it installs from the reachable registry. Extract it once:

```bash
cd /tmp && mkdir -p chrome-npm && cd chrome-npm && npm init -y
npm install @sparticuz/chromium@123
node -e "require('@sparticuz/chromium').executablePath().then(p=>console.log(p))"
# → /tmp/claude-0/chromium  (run with --no-sandbox since the container is root)
```

Point Playwright at it with a throwaway config that extends the repo one
(do **not** commit this file):

```ts
// apps/web/e2e/playwright.local.config.ts
import base from './playwright.config';
const config: any = { ...base };
config.projects = (base as any).projects.map((p: any) => ({
  ...p,
  use: {
    ...p.use,
    launchOptions: {
      executablePath: '/tmp/claude-0/chromium',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    },
  },
}));
export default config;
```

---

## 5. Run

```bash
cd apps/web/e2e && npm install                     # e2e has its own package.json
npx playwright test --config playwright.local.config.ts --project=setup   # auth
npx playwright test --config playwright.local.config.ts --project=chromium \
  phase-scheduling.spec.ts admin-flow-editing.spec.ts --reporter=list
```

To run the **full** suite, drop the per-file arguments and run all chromium specs:

```bash
npx playwright test --config playwright.local.config.ts --project=chromium --reporter=list
```

---

## 6. Report

After the run, produce a structured report:

- **Summary table**: Passed / Failed / Skipped counts.
- **Failures**: for each — test name + file, verbatim error (first 3 lines),
  diagnosed root cause (read the source, don't assume), proposed fix.
- **Skips**: categorise as *by design* (needs specific DB state) vs *needs
  investigation*.
- **Recommendations**: actionable next steps only, distinguishing test bugs from
  application bugs.

---

## Gotchas

- The app runs in **dev mode**, so the first navigation to a heavy route (the
  ReactFlow canvas) triggers on-demand compilation and can take >10s — size
  navigation timeouts accordingly.
- Specs run sequentially (`workers: 1`, shared auth state) and the DB is **not**
  reset between files, so flows created by `admin-flow-editing` are still there
  when later specs run.
- `@sparticuz/chromium` is ~Chromium 123 while Playwright (1.60) bundles ~143.
  Stick with **`@sparticuz/chromium@123`**: bumping to `@143` (to match CI) was
  tried and is *worse* — it adds flaky logout-context timeouts and does **not**
  fix the hydration failures below, confirming those are app-level, not browser.
- `s3rver` returns `403 InvalidAccessKeyId` if the app still uses the default
  `minioadmin` credentials — it only accepts its own `S3RVER`/`S3RVER` pair.
  Set `MINIO_ACCESS_KEY`/`MINIO_SECRET_KEY` accordingly (step 3). If the app
  booted before `s3rver` was up you'll see one `MinIO initialisation failed`
  warning in `/tmp/web.log`; it's harmless — the adapter reconnects lazily on
  the first upload, no restart needed.
- The background Postgres/dev-server/s3rver can be reaped on container
  inactivity — just re-run steps 1–3 (`pg_ctl start` / `node run.js` / `pnpm
  dev`) to bring them back.

---

## Known-failing specs (pre-existing — not caused by this recipe)

Most of the earlier failures were fixed in v1.38.1 (browser-injected
caret-color hydration noise is now filtered centrally in `helpers/base.ts`;
the stale roles/flags and node-config/register specs were rewritten; CI gained
a MinIO container). Storage specs pass once `E2E_OBJECT_STORAGE=1` and `s3rver`
are in place: `phase-rag-with-pgvector` (both), `enhance-reindex-documents`,
`enhance-configurable-embeddings`.

Two remain, and are **out of scope** for this recipe — don't chase them:

- `fix-prior-step-fields-stripped.spec.ts:182` — mocked `.docx` template-upload
  pill never renders; deterministic, needs an app/test investigation.
- `enhance-n8n-workflow-context-mapping.spec.ts:102` — flaky: the heavy
  `/flows/[id]/config` route can exceed the 45s test timeout on its first
  (cold) dev-mode compile. Usually passes on a warm server.
