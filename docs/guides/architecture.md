# Architecture

This template is built on **hexagonal architecture** (a.k.a. ports & adapters).
The point is to keep business rules independent of frameworks, databases,
and AI providers, so we can change any of them without rewriting the core.

## Packages

```
packages/
├── domain/        Pure TypeScript. Entities, port interfaces, domain errors,
│                  the Result type. Zero external dependencies.
├── application/   Use cases. Orchestrates ports. Imports only @rbrasier/domain
│                  and @rbrasier/shared. No frameworks, no SDKs.
├── shared/        Zod schemas and shared types used at boundaries
│                  (HTTP/tRPC inputs, AI output schemas).
└── adapters/      Concrete implementations of domain ports.
                   Drizzle, Vercel AI SDK, LangGraph, Langfuse, Better Auth.
```

```
apps/
├── web/   Next.js 15 + tRPC. Wires adapters in lib/container.ts.
└── api/   Express + Zod. Wires adapters in src/container.ts.
```

## Dependency rules (enforced)

- `domain` imports nothing outside itself. ESLint blocks any non-relative
  import path in `packages/domain/src/**`.
- `application` may import only `@rbrasier/domain` and `@rbrasier/shared`.
  ESLint blocks `@rbrasier/adapters`, ORMs, AI SDKs, frameworks.
- `adapters` may import everything it needs, and depends on `domain` only via
  port interfaces.
- Apps depend on `application` and `adapters`. All wiring lives in their
  `container.ts`.

## The Result pattern

Ports never throw across the domain boundary. Every async port method returns:

```ts
type Result<T> = { data: T } | { error: DomainError };
```

Use `ok(value)`, `err(domainError(code, message))`, and the `isOk` / `isErr`
guards from `@rbrasier/domain`. Adapters wrap try/catch and convert SDK errors
into a `DomainError` with a code from a small enum (`NOT_FOUND`,
`AI_PROVIDER_FAILED`, `INFRA_FAILURE`, etc.).

This keeps error handling explicit at every layer. tRPC procedures and Express
routes translate `DomainError.code` into the right HTTP status.

## Adding a use case

1. **Domain**: if new entities or ports are needed, add them to
   `packages/domain/src/entities` or `packages/domain/src/ports`. Wire them
   into the barrel `index.ts`.
2. **Application**: create a class in `packages/application/src/use-cases/`
   that takes its dependencies (ports) via the constructor. Return `Result<T>`.
   Add a co-located `*.test.ts` that uses an in-memory fake of each port.
3. **Adapters**: if you need a new external dependency, implement the port
   in `packages/adapters/src/`. Convert SDK errors into `DomainError`s.
4. **Apps**: wire the use case in `apps/web/src/lib/container.ts` (and / or
   `apps/api/src/container.ts`). Expose it via tRPC or an Express route.
5. **Shared**: add Zod input/output schemas to `packages/shared/src/schemas/`
   so the boundary is typed end-to-end.

## Why we ban LangGraph from `domain`

LangGraph is one possible agent runtime. The contract our application cares
about is `IAgentRunner.run(input, config) → Result<AgentOutput>`. Wrapping
LangGraph behind that port means we can swap to a different orchestrator
(or no orchestrator) by writing one new adapter.

## Diagram

```
                          ┌────────────────────────┐
                          │  apps/web  apps/api    │
                          │   (wire adapters)      │
                          └──────┬─────────────────┘
                                 │ depends on
                                 ▼
       ┌──────────────────────────────────────────────────┐
       │              packages/application                │
       │            (use cases, no SDK code)              │
       └──────┬───────────────────────────────────────────┘
              │ depends on
              ▼
       ┌──────────────────────────────────────────────────┐
       │              packages/domain                     │
       │  entities, ports (interfaces), errors, Result    │
       │           ZERO external dependencies             │
       └──────────────────────────────────────────────────┘
              ▲ implements
       ┌──────┴───────────────────────────────────────────┐
       │              packages/adapters                   │
       │ Drizzle, Vercel AI SDK, LangGraph, Langfuse,     │
       │             Better Auth, Postgres                │
       └──────────────────────────────────────────────────┘
```
