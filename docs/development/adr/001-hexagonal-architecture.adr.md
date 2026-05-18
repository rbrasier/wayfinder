# ADR-001 — Hexagonal Architecture (Ports & Adapters)

- **Status**: Accepted
- **Date**: 2026-05-07

## Context

This is a template for AI-heavy applications. AI applications attract three
sources of churn: model providers change every quarter, agent frameworks come
and go, and observability tooling evolves rapidly. We want the business logic
to outlive the choice of any single SDK.

## Decision

Adopt **hexagonal architecture** as the foundational structural pattern.

- `packages/domain` defines port interfaces. It has **zero external imports**.
- `packages/application` orchestrates ports into use cases. It depends on
  `packages/domain` and `packages/shared` only.
- `packages/adapters` implements ports against real systems (Drizzle,
  Vercel AI SDK, LangGraph, Langfuse, Better Auth).
- Apps wire adapters in their `container.ts` factories. No DI container
  library is used.
- All port methods return `Result<T> = { data: T } | { error: DomainError }`.
  Errors never propagate as thrown exceptions across the domain boundary.

## Consequences

**Positive**

- Use cases are testable with in-memory fakes. No database needed for a
  unit-test pass.
- Provider swaps (anthropic → openai → mistral) require one new file in
  the adapters layer, not a search-and-replace across the codebase.
- Error handling is explicit — every call site sees the error variant in
  its types and must handle it.

**Negative**

- More files than a layered or transaction-script approach. We accept this
  as the tax for keeping AI churn out of the core.
- Developers must internalise that `domain` cannot import frameworks. ESLint
  and `validate.sh` enforce this so new contributors fail fast.

## Enforcement

- ESLint `no-restricted-imports` blocks non-relative imports inside
  `packages/domain/src/**`.
- ESLint blocks `@rbrasier/adapters/*`, ORM/SDK imports inside
  `packages/application/src/**`.
- `validate.sh` greps `packages/domain/src` for any non-relative `from "…"`.
