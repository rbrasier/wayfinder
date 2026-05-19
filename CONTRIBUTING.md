# Contributing to Wayfinder

Contributions are welcome and accepted under the terms of the
[Functional Source Licence 1.1](LICENSE).

---

## Adding a new node executor

Node executors live in `packages/adapters/src/node-executors/`. Each executor
implements the `INodeExecutor` port from `packages/domain/src/ports/node-executor.ts`.

1. Create `packages/adapters/src/node-executors/my-executor.ts`
2. Write a test file first: `my-executor.test.ts`
3. Export it from `packages/adapters/src/node-executors/index.ts`
4. Wire it into `apps/web/src/lib/container.ts`

## Adding a new flow type / document template

Document templates are `.docx` files using `{{tag}}` placeholders
(docxtemplater syntax). Place example templates in `docs/templates/`
and upload them via the admin canvas.

## Adding a new domain port

1. Create the interface in `packages/domain/src/ports/`
2. Export from `packages/domain/src/ports/index.ts`
3. Implement in `packages/adapters/src/`
4. Wire via the container

**Domain purity is enforced**: `packages/domain` has zero external imports.
`validate.sh` will fail if you add one.

## Running checks

```bash
./validate.sh
```

All checks must pass before a PR can merge.

## Commit style

```
feat: add MinIO storage adapter
fix: handle null branchChoice after three retries
chore: bump version to 1.5.0
```

## Code style

- Return early; no nesting beyond 2 levels
- No comments explaining what — only why
- Result pattern at all package boundaries
- Tests before implementation
