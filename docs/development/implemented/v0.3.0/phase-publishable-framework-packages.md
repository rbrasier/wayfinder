# Phase: Publishable Framework Packages (Spark Model)

- **Status**: Draft
- **Date**: 2026-05-10
- **Target version**: 0.3.0 (bump: MINOR — new capability, no breaking domain changes)

---

## 1. Goal

Convert the internal monorepo packages into versioned, published npm packages so
that projects bootstrapped from this template can receive ongoing updates — exactly
as Laravel Spark projects receive billing/auth improvements via `composer update`.

Today, a project generated from this template is a dead fork. After this phase,
it becomes a **consumer** of published packages. Framework improvements (new AI
provider, better health checks, improved auth, new admin UI features) flow to
every downstream project via `pnpm update @your-org/adapters`.

---

## 2. The Split: Framework vs. Project-Owned

The key insight is that every SaaS app needs the same infrastructure concerns.
The framework owns all of them. Projects layer their domain on top.

### Framework (published to npm / GitHub Packages)

| Package | Scope | What it provides |
|---|---|---|
| `@your-org/core` | Pure TS, zero deps | Result type, DomainError, all base entities, all port interfaces |
| `@your-org/shared` | Zod only | Zod schemas for all framework features (user, AI, error-log) |
| `@your-org/application` | Depends on core + shared | All framework use cases (user CRUD, error management, AI chat, flags, usage, jobs, health) |
| `@your-org/adapters` | All framework deps | Every concrete implementation: DB client, schema, repos, auth, AI, logging, health, observability, telemetry |
| `@your-org/ui` *(future)* | React + Next.js | Admin UI components, packaged so pages update via `pnpm update` |

### Project-Owned (generated once by scaffold, then owned by the project)

| Generated layer | Purpose |
|---|---|
| `packages/domain/` | Project-specific entities and ports (extends framework types) |
| `packages/application/` | Project-specific use cases (wires framework + project use cases) |
| `packages/shared/` | Project-specific Zod schemas |
| `apps/web/` | Next.js app — thin wrappers over framework components + project pages |
| `apps/api/` | Express API — mounts framework routes + project routes |
| `*/lib/container.ts` | Dependency injection — wires framework adapters, optionally swaps overrides |

---

## 3. Detailed Package Contents

### `@your-org/core`
> Source today: `packages/domain/`

**Entities** (one type per concept — plain TypeScript, no decorators):

| Entity | Key fields | Used by |
|---|---|---|
| `User` | `id`, `email`, `name`, `role`, `createdAt`, `updatedAt` | Auth, user management |
| `NewUser` | `email`, `name`, `role` | Create user use case |
| `UserUpdate` | Partial of User fields | Update user use case |
| `Conversation` | `id`, `userId`, `title`, `createdAt` | AI chat |
| `Message` | `id`, `conversationId`, `role`, `content`, `createdAt` | AI chat |
| `NewConversation` | `userId`, `title` | Send message use case |
| `NewMessage` | `conversationId`, `role`, `content` | Send message use case |
| `AuditLog` | `id`, `userId`, `action`, `resource`, `metadata`, `createdAt` | Compliance |
| `NewAuditLog` | `userId`, `action`, `resource`, `metadata` | Log audit event use case |
| `ErrorLog` | `id`, `level`, `message`, `stack`, `context`, `status`, `createdAt` | Error monitoring |
| `ErrorLogLevel` | `error` \| `warn` \| `info` \| `debug` \| `fatal` | Error classification |
| `ErrorLogStatus` | `open` \| `resolved` \| `ignored` | Error triage |
| `NewErrorLog` | `level`, `message`, `stack?`, `context?` | Log error use case |
| `ErrorLogGroup` | `message`, `level`, `count`, `lastSeen` | Grouped error view |
| `ErrorLogFilter` | `level?`, `status?`, `search?`, `limit`, `offset` | Error list pagination |
| `FeatureFlag` | `id`, `key`, `value`, `description`, `createdAt`, `updatedAt` | Feature rollouts |
| `NewFeatureFlag` | `key`, `value`, `description?` | Create/upsert flag |
| `UsageEvent` | `id`, `userId`, `model`, `provider`, `inputTokens`, `outputTokens`, `costUsd`, `createdAt` | Token billing |
| `NewUsageEvent` | `userId`, `model`, `provider`, `inputTokens`, `outputTokens`, `costUsd` | Track usage use case |
| `UsageSummary` | `totalEvents`, `totalInputTokens`, `totalOutputTokens`, `totalCostUsd`, `byModel[]` | Usage analytics |
| `Job` | `id`, `name`, `status`, `lastPingAt`, `failReason?`, `createdAt` | Background job health |
| `JobStatus` | `healthy` \| `stale` \| `failed` | Job monitoring |
| `SystemHealth` | `status`, `services[]`, `jobs`, `ai` | Health dashboard |
| `ServiceStatus` | `name`, `status`, `latencyMs?`, `error?` | Per-service health |

**Port interfaces** (the contracts adapters must implement):

| Interface | Methods | Implemented by |
|---|---|---|
| `ILogger` | `debug`, `info`, `warn`, `error`, `fatal` | `PinoLogger` |
| `IErrorLogger` | `log(payload: ErrorLogPayload)` | `DrizzleErrorLogger` |
| `IAuditLogger` | `log(entry: NewAuditLog)` | `DrizzleAuditLogger` |
| `IUserRepository` | `create`, `findById`, `findByEmail`, `update`, `delete`, `list` | `DrizzleUserRepository` |
| `IConversationRepository` | `createConversation`, `appendMessage`, `getHistory`, `list` | `DrizzleConversationRepository` |
| `IErrorLogRepository` | `create`, `list`, `listGrouped`, `listInGroup`, `updateStatus`, `updateStatusByGroup` | `DrizzleErrorLogRepository` |
| `IFeatureFlagRepository` | `get`, `upsert`, `list` | `DrizzleFeatureFlagRepository` |
| `IUsageRepository` | `create`, `summarize` | `DrizzleUsageRepository` |
| `IJobRepository` | `register`, `ping`, `fail`, `list` | `DrizzleJobRepository` |
| `ILanguageModel` | `generateObject`, `streamText`, `streamObject` | `LanguageModelAdapter` |
| `IAgentRunner` | `run(input: AgentInput): Promise<AgentOutput>` | `LangGraphAgentRunner` |
| `IHealthChecker` | `check(): Promise<ServiceStatus>` | `DbHealthChecker`, `RedisHealthChecker`, `AiHealthChecker` |

**Utilities:**

| Export | Purpose |
|---|---|
| `Result<T>` | `{ data: T } \| { error: DomainError }` — the boundary type |
| `ok(data)` | Constructs a success result |
| `err(error)` | Constructs an error result |
| `isOk(r)` | Type guard |
| `isErr(r)` | Type guard |
| `DomainError` | Base error type with `code` and `message` |
| `DomainErrorCode` | Enum of all framework error codes |
| `domainError(code, message)` | Factory |

**Publishing notes:**
- Zero external dependencies — smallest possible bundle
- Ships as ESM only (pure TypeScript types compile to clean ESM)
- No build step needed — ships source directly (types + runtime are the same)

---

### `@your-org/shared`
> Source today: `packages/shared/`

**Zod schemas** (used for input validation at app boundaries):

| Schema | Validates | Used by |
|---|---|---|
| `createUserInputSchema` | `email`, `name`, `role` | `POST /users`, tRPC `user.create` |
| `updateUserInputSchema` | `id`, partial user fields | `PATCH /users`, tRPC `user.update` |
| `deleteUserInputSchema` | `id` | `DELETE /users`, tRPC `user.delete` |
| `listUsersInputSchema` | `limit`, `offset`, `search?` | `GET /users`, tRPC `user.list` |
| `sampleResponseSchema` | `response`, `confidence`, `rationale` | AI demo structured output |
| `errorLevelSchema` | union of `ErrorLogLevel` values | Error log filtering |
| `errorStatusSchema` | union of `ErrorLogStatus` values | Error status update |
| `logErrorInputSchema` | `level`, `message`, `stack?`, `context?` | Log error tRPC call |
| `listErrorsInputSchema` | `filter: ErrorLogFilter` | List errors tRPC call |
| `updateErrorStatusInputSchema` | `id`, `status` | Update error status |
| `sendMessageInputSchema` | `conversationId?`, `content` | AI chat tRPC call |

**Publishing notes:**
- Peer dependency on `zod ^3.x`
- Types inferred from schemas are re-exported for convenience

---

### `@your-org/application`
> Source today: `packages/application/`

**Framework use cases** (orchestrate ports from `@your-org/core`):

| Use case class | Ports consumed | What it does |
|---|---|---|
| `CreateUser` | `IUserRepository`, `IAuditLogger` | Checks for duplicate email, creates user, logs audit event |
| `UpdateUser` | `IUserRepository`, `IAuditLogger` | Validates user exists, applies update, logs audit event |
| `DeleteUser` | `IUserRepository`, `IAuditLogger` | Validates user exists, deletes, logs audit event |
| `ListUsers` | `IUserRepository` | Paginated user list with optional search |
| `LogError` | `IErrorLogRepository` | Persists error log entry |
| `ListErrors` | `IErrorLogRepository` | `listGrouped()` and `listInGroup()` with filters |
| `UpdateErrorStatus` | `IErrorLogRepository` | `byId()` and `byGroup()` status transitions |
| `SendMessage` | `IConversationRepository`, `ILanguageModel`, `IUsageRepository` | Creates/resumes conversation, streams LLM response, tracks token usage |
| `LogAuditEvent` | `IAuditLogger` | Thin wrapper ensuring Result-pattern return |
| `GetFeatureFlag` | `IFeatureFlagRepository` | Get by key, returns default if missing |
| `UpsertFeatureFlag` | `IFeatureFlagRepository` | Create or update a flag |
| `ListFeatureFlags` | `IFeatureFlagRepository` | Full flag list |
| `TrackUsage` | `IUsageRepository` | Persist usage event |
| `GetUsageSummary` | `IUsageRepository` | Aggregated summary with per-model breakdown |
| `RegisterJob` | `IJobRepository` | Register a background job heartbeat |
| `PingJob` | `IJobRepository` | Update last-seen timestamp |
| `FailJob` | `IJobRepository` | Mark job as failed with reason |
| `ListJobs` | `IJobRepository` | List all registered jobs with status |
| `GetSystemHealth` | `IHealthChecker`, `IJobRepository` | Aggregates service health + job health + AI status |

**Publishing notes:**
- Peer dependencies on `@your-org/core` and `@your-org/shared`
- No framework imports — pure TypeScript class orchestration
- Each use case is independently importable for tree-shaking

---

### `@your-org/adapters`
> Source today: `packages/adapters/`

#### Database schema (Drizzle + PostgreSQL + pgvector)

All tables are shipped with the package. Projects run framework migrations via
`pnpm exec drizzle-kit migrate` using the exported Drizzle config.

**`core_` group — identity and access:**

| Table | Columns | Purpose |
|---|---|---|
| `core_users` | `id` (uuid PK), `email` (unique), `name`, `role`, `emailVerified`, `image`, `createdAt`, `updatedAt` | Application users, managed by Better Auth |
| `core_sessions` | `id`, `userId` (FK → core_users), `token` (unique), `expiresAt`, `ipAddress`, `userAgent`, `createdAt`, `updatedAt` | Auth sessions |
| `core_verification_tokens` | `id`, `identifier`, `value` (unique), `expiresAt`, `createdAt`, `updatedAt` | Magic-link tokens |
| `core_audit_log` | `id` (uuid PK), `userId` (FK → core_users, nullable), `action`, `resource`, `metadata` (jsonb), `createdAt`, `updatedAt` | Compliance audit trail |
| `core_feature_flag` | `id` (uuid PK), `key` (unique), `value` (boolean), `description`, `createdAt`, `updatedAt` | Feature toggle store |

**`ai_` group — LLM interactions:**

| Table | Columns | Purpose |
|---|---|---|
| `ai_conversations` | `id` (uuid PK), `userId` (FK → core_users), `title`, `createdAt`, `updatedAt` | Chat conversation threads |
| `ai_messages` | `id` (uuid PK), `conversationId` (FK → ai_conversations), `role` (`user`\|`assistant`\|`system`), `content`, `createdAt`, `updatedAt` | Individual messages in a thread |
| `ai_usage_events` | `id` (uuid PK), `userId` (FK → core_users), `model`, `provider`, `inputTokens`, `outputTokens`, `costUsd` (numeric), `createdAt`, `updatedAt` | Token consumption for billing analytics |

**`app_` group — observability:**

| Table | Columns | Purpose |
|---|---|---|
| `app_error_log` | `id` (uuid PK), `level` (enum), `message`, `stack` (text, nullable), `context` (jsonb, nullable), `status` (enum, default `open`), `createdAt`, `updatedAt` | Centralised application error store |

Indices on `app_error_log`: `(level)`, `(status)`, `(message, level)` for grouped queries.

**`job_` group — background tasks:**

| Table | Columns | Purpose |
|---|---|---|
| `job_registry` | `id` (uuid PK), `name` (unique), `status` (enum), `lastPingAt`, `failReason` (nullable), `createdAt`, `updatedAt` | Heartbeat registry for background jobs |

#### Concrete implementations

**Repositories** (implement ports from `@your-org/core`):

| Class | Implements | Notes |
|---|---|---|
| `DrizzleUserRepository` | `IUserRepository` | Full CRUD, email uniqueness enforced at DB level |
| `DrizzleConversationRepository` | `IConversationRepository` | Append-only messages, history retrieval |
| `DrizzleErrorLogRepository` | `IErrorLogRepository` | Group aggregation via SQL `GROUP BY message, level` |
| `DrizzleFeatureFlagRepository` | `IFeatureFlagRepository` | Upsert via `ON CONFLICT DO UPDATE` |
| `DrizzleUsageRepository` | `IUsageRepository` | `summarize()` aggregates with per-model breakdown |
| `DrizzleJobRepository` | `IJobRepository` | Stale detection via `lastPingAt` threshold |

**AI providers:**

| Export | Purpose |
|---|---|
| `LanguageModelAdapter` | Implements `ILanguageModel` — wraps Vercel AI SDK `generateObject`/`streamText`/`streamObject` |
| `resolveModel(provider, modelId)` | Returns the correct AI SDK model instance for any supported provider |
| `defaultModelFor(provider)` | Returns the default model ID string for a given provider |
| Supported providers | `anthropic` (claude-sonnet-4-6 default), `openai` (gpt-4o default), `mistral` (mistral-large default) |

**Agents:**

| Export | Purpose |
|---|---|
| `LangGraphAgentRunner` | Implements `IAgentRunner` — runs a LangGraph.js graph, returns structured `AgentOutput` |

**Auth:**

| Export | Purpose |
|---|---|
| `createAuth(db, config)` | Configures Better Auth with Drizzle adapter + magic-link plugin |
| `resolveSession(token, auth)` | Looks up a session token, returns `User \| null` |
| `seedAdmin(db, email)` | Creates the initial admin user on first run |

**Logging:**

| Export | Purpose |
|---|---|
| `PinoLogger` | Implements `ILogger` — structured JSON in production, pretty-printed in development |

**Error & Audit:**

| Export | Purpose |
|---|---|
| `DrizzleErrorLogger` | Implements `IErrorLogger` — persists to `app_error_log` |
| `DrizzleAuditLogger` | Implements `IAuditLogger` — persists to `core_audit_log` |

**Health checks:**

| Export | Purpose |
|---|---|
| `DbHealthChecker` | Implements `IHealthChecker` — runs `SELECT 1`, measures latency |
| `RedisHealthChecker` | Implements `IHealthChecker` — runs `PING`, measures latency |
| `AiHealthChecker` | Implements `IHealthChecker` — verifies at least one AI provider key is set |
| `CompositeHealthChecker` | Runs all `IHealthChecker` instances in parallel, returns aggregated `SystemHealth` |

**Observability:**

| Export | Purpose |
|---|---|
| `LangfuseTracingAdapter` | Optional wrapper — traces AI calls through Langfuse |
| `UsageTrackingAdapter` | Wraps `ILanguageModel` — intercepts responses, extracts token counts, estimates cost |

**Telemetry:**

| Export | Purpose |
|---|---|
| `setupTelemetry(config)` | Initialises OpenTelemetry SDK with OTLP exporter, HTTP + Express + PG instrumentation |
| `shutdownTelemetry()` | Graceful flush on process exit |

**Publishing notes:**
- All framework deps (drizzle-orm, better-auth, ai, @ai-sdk/*, langfuse, pino, ioredis, etc.) become **peer dependencies**
- Project controls which version of each framework dep it installs
- Build via `tsup` producing ESM + CJS + `.d.ts`
- Sub-path exports preserved exactly as today (`@your-org/adapters/db`, `/auth`, `/ai`, etc.)

---

## 4. What Stays in the Scaffold (Generated Once)

When a project is bootstrapped from the template, the scaffold generator creates:

```
packages/
  domain/           ← project entities and ports (plain TypeScript)
  application/      ← project use cases (imports @your-org/core + @your-org/application)
  shared/           ← project Zod schemas

apps/
  web/
    src/
      app/
        (user)/
          page.tsx               ← home page (project-owned)
        (admin)/
          admin/
            layout.tsx           ← thin wrapper — renders @your-org/ui admin shell
            page.tsx             ← renders @your-org/ui AdminHub component
            users/page.tsx       ← renders @your-org/ui UserManagement component
            errors/page.tsx      ← renders @your-org/ui ErrorLogViewer component
            flags/page.tsx       ← renders @your-org/ui FeatureFlagManager component
            usage/page.tsx       ← renders @your-org/ui UsageAnalytics component
            login/page.tsx       ← renders @your-org/ui AdminLogin component
        api/
          auth/[...all]/route.ts ← 3-line Better Auth handler (project-owned config)
          trpc/[trpc]/route.ts   ← standard tRPC handler
      server/
        router.ts                ← merges framework router + project routers
        routers/                 ← project-specific tRPC routers go here
      lib/
        container.ts             ← dependency injection (wires framework + project adapters)
        env.ts                   ← project env vars
  api/
    src/
      container.ts               ← same pattern as web container
      routes/                    ← project routes (framework routes imported from package)
```

The key principle: **admin pages are thin wrappers** that render published components.
When `@your-org/ui` ships a new feature (e.g. bulk error resolution), running
`pnpm update @your-org/ui` makes it appear in every downstream project automatically.

---

## 5. Override Patterns

Projects have three levels of override, from least to most invasive:

### Level 1 — Configuration (zero code change)

Most adapters accept a config object. Pass custom options at construction time in `container.ts`:

```typescript
// lib/container.ts
import { createDrizzleAdapters } from "@your-org/adapters";

const adapters = createDrizzleAdapters(db, {
  userRepo: undefined,          // use default DrizzleUserRepository
  aiProvider: "openai",         // override default provider
  langfuseEnabled: false,       // disable tracing
});
```

### Level 2 — Swap (implement the port yourself)

Because every adapter implements an interface from `@your-org/core`, any piece can be
replaced by providing an alternative implementation in `container.ts`:

```typescript
import { IUserRepository } from "@your-org/core";

class MyUserRepository implements IUserRepository {
  // your custom implementation
}

// In container.ts — just pass a different instance
const userRepo: IUserRepository = new MyUserRepository(db);
```

The rest of the application never knows the difference.

### Level 3 — Extend (subclass the published adapter)

When you want the base behaviour plus additions:

```typescript
import { DrizzleUserRepository } from "@your-org/adapters/repositories";

class MyUserRepository extends DrizzleUserRepository {
  async findByEmail(email: string) {
    const result = await super.findByEmail(email);
    // post-process, cache, emit event, etc.
    return result;
  }
}
```

### Level 4 — Eject (copy source, stop receiving updates)

For cases where the published implementation is fundamentally wrong for your
use case, an `eject` CLI command copies the adapter source into your project:

```bash
npx @your-org/cli eject DrizzleUserRepository
# copies packages/adapters/src/repositories/drizzle-user-repository.ts
# into your-project/packages/adapters/src/repositories/
# and updates container.ts import to point at the local copy
```

After ejection you own that file and stop receiving framework updates for it.
All other adapters continue to update normally.

---

## 6. Publishing Infrastructure

### Registry

GitHub Packages under the org scope (e.g. `@rbrasier/*`). Advantages:
- Co-located with the repo
- Access controlled by GitHub permissions
- Free for public packages, included in org plan for private

### Build tooling

Replace `tsc -p tsconfig.json` with `tsup` in each package:

```json
// package.json (each published package)
{
  "scripts": {
    "build": "tsup src/index.ts --format esm,cjs --dts"
  },
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    }
  }
}
```

### Version management

Changesets handles coordinated version bumps across packages:

```
pnpm changeset        # describe what changed (runs interactively)
pnpm changeset version # bumps versions and updates changelogs
pnpm changeset publish # publishes all changed packages
```

### Release workflow (`.github/workflows/release.yml`)

```
on: push to main

steps:
  1. pnpm install
  2. pnpm build (all packages)
  3. pnpm test
  4. changeset publish (only if changesets present)
```

### Scaffold CLI

A small `@your-org/create` package (published to npm) runs the scaffold:

```bash
npx @your-org/create my-saas-app
```

Prompts:
- Project name (replaces `template` everywhere)
- Default AI provider
- Enable Langfuse day one?
- GitHub Packages registry URL

Then:
1. Clones the scaffold template (the `apps/` and `packages/domain`, `packages/application`, `packages/shared` stubs)
2. Writes `package.json` with `@your-org/*` as dependencies at latest version
3. Runs `pnpm install`
4. Runs `pnpm exec drizzle-kit migrate` to apply framework migrations

---

## 7. Implementation Steps

### Step 1 — Add tsup to all packages

- Add `tsup` as a dev dependency to `packages/domain`, `packages/shared`, `packages/application`, `packages/adapters`
- Write `tsup.config.ts` for each with appropriate entry points
- Update `scripts.build` and `exports` in each `package.json`
- Verify `pnpm build` still works across the monorepo

### Step 2 — Mark packages as publishable

- Remove `"private": true` from `packages/domain`, `packages/shared`, `packages/application`, `packages/adapters`
- Add `"publishConfig": { "registry": "https://npm.pkg.github.com", "access": "public" }`
- Rename packages from `@rbrasier/*` to `@your-org/*` (placeholder — user provides org name at scaffold time)

### Step 3 — Convert framework deps in adapters to peer deps

Move all runtime deps in `packages/adapters/package.json` from `dependencies` to `peerDependencies`:
- `drizzle-orm`, `better-auth`, `ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/mistral`
- `@langchain/core`, `@langchain/langgraph`, `langfuse`
- `pino`, `ioredis`, `postgres`
- `@opentelemetry/*`

These stay as `dependencies` (build-time only):
- `drizzle-kit` (devDependency for migrations)
- `tsup`, `typescript`, `vitest`

### Step 4 — Implement `createAdapters` factory

Replace direct class instantiation with a factory function in `packages/adapters/src/index.ts`:

```typescript
export function createAdapters(db: Database, config: AdaptersConfig): Adapters {
  // wires all repos, logger, health checkers etc.
  // config.overrides allows per-adapter replacement
}
```

This is the primary API surface for `container.ts` in downstream projects.

### Step 5 — Set up Changesets

```bash
pnpm add -Dw @changesets/cli
pnpm changeset init
```

Configure `.changeset/config.json`:
- `baseBranch: "main"`
- `packages: ["packages/domain", "packages/shared", "packages/application", "packages/adapters"]`

### Step 6 — Create GitHub Actions release workflow

`.github/workflows/release.yml` — triggered on push to main, runs Changesets publish action.

`.github/workflows/ci.yml` — triggered on PR, runs typecheck + lint + test + validate.sh.

### Step 7 — Create the scaffold CLI

New `packages/create/` package published as `@your-org/create`. Contains:
- `src/index.ts` — interactive prompts (clack or inquirer)
- `templates/` — the scaffold files (domain stub, application stub, app shells)
- Replaces all `@rbrasier/` occurrences with `@project-name/`
- Installs `@your-org/*` from registry

### Step 8 — Implement eject command

Add `packages/cli/` package published as `@your-org/cli`:
- `eject <AdapterClassName>` — copies source file to project, updates imports
- Maintains a `.framework-version` file tracking which framework version the project was scaffolded from

### Step 9 — Update validate.sh

Add checks:
- Published packages have no `private: true`
- `dist/` exists for each published package (built)
- Peer dependency versions in `adapters` are valid ranges
- `@rbrasier/` scope is zero in published packages (only `@your-org/`)

### Step 10 — Documentation

- `docs/guides/updating-the-framework.md` — how downstream projects run `pnpm update`
- `docs/guides/overriding-adapters.md` — the four override levels with examples
- `docs/guides/publishing-a-release.md` — how to cut a release with Changesets
- Update `README.md` with the new "install vs. generate" distinction

---

## 8. Version Bump

This is a MINOR bump: `0.2.0 → 0.3.0`.

No breaking changes to the domain model or existing use cases. The internal
`@rbrasier/*` scope changes to `@your-org/*` but that is a scaffold-level rename,
not an API break. Downstream projects generated after this phase will use the
published packages. Existing projects remain on the old internal structure
until they opt in.

---

## 9. Known Limitations and Open Questions

1. **Org name placeholder** — this doc uses `@your-org`. The actual org name must be
   decided before Step 2. Options: `@rbrasier` (GitHub username), a new org, or a
   product name.

2. **Admin UI packaging** — `@your-org/ui` is marked *future* above. For now, admin
   pages remain in the scaffold. A follow-on phase extracts them into a published
   component library. Without this, admin page updates still require a scaffold
   re-generation or manual merge.

3. **Migration versioning** — when `@your-org/adapters` adds a new table or column,
   downstream projects need to run migrations. The update workflow should include
   a `pnpm exec drizzle-kit migrate` step. This needs documentation and possibly
   a CLI helper that detects pending framework migrations.

4. **Private vs. public registry** — if this framework is for internal use only,
   GitHub Packages with org-scoped access is appropriate. If it becomes a
   commercial product (like Spark), npm is the correct registry.

5. **The `eject` command scope** — ejecting one repository class is straightforward.
   Ejecting a whole module (e.g. the entire auth system) requires more thought
   about transitive dependencies.
