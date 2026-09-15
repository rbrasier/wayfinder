# Phase — Lookup Source Config Discovery & In-App Credentials

- **Status**: Awaiting review
- **Target version**: 0.31.0 (no new bump — folds into the unreleased v0.31.0 work)
- **Base branch**: `main` (release line `alpha-3`), on `claude/external-field-values-phase-gb98mt`, updating PR #250
- **PRD**: `docs/development/prd/external-field-values.prd.md`
- **ADR**: ADR-050 — amended by this phase (§2a credential storage, §2b Test-time discovery)
- **Enhances**: `implemented/alpha-3/v0.31.0/external-field-values.phase.md`

## 1. Problem

Two rough edges in the lookup-source editor, found on review of the shipped UI.

**Record path is guesswork.** The admin types `recordsPath` (`result.items`) from
memory. Get it wrong and Test reports "did not return a list of records" without
saying what it *did* return. The n8n integration sets the precedent: the app
retrieves what the endpoint returns and lets the operator pick from it.

**Credentials come from the environment.** `credentialRef` names an environment
variable, so configuring a source is a two-place job — the app for the URL, the
container's environment for the secret — and an admin cannot complete it alone.
Every other secret in Wayfinder (n8n API key, AI provider keys, SMTP password)
is typed into the app and encrypted at rest under `SETTINGS_ENCRYPTION_KEY`.

## 2. Goals

- Test walks the response, finds every array-of-records in it, and offers them
  as a **Records** picker: path, record count, field names.
- Choosing a collection sets `recordsPath` and scopes the display/key choices to
  that collection's fields.
- The `api` kind stores an encrypted credential in the database, entered in the
  app, with n8n's save semantics: blank means keep the current secret.
- No query ever returns the secret — `list` reports `credentialSet` only.

## 3. Non-goals

Credential rotation or bulk re-encryption tooling (the existing settings
encryption has none either); `managed` row editing; `api` cursor pagination;
structured-capture re-resolution. All remain the follow-ups already recorded.

## 4. Approach

Bottom-up, test before implementation. The JSON walk is a pure domain function
so its bounds are unit-testable without a network. The credential never reaches
the read model: the repository encrypts on write and exposes `readCredential`,
which only the caching provider calls, and only for the `api` kind.

**Testing layer** (`docs/guides/e2e-test-policy.md`): none of this falls into
the six browser-only groups. Domain owns the walk, application owns Test's
collection resolution, adapters own discovery/encryption, `apps/web` gets router
and component-model tests. **No new Playwright spec.**

## 5. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| domain | `entities/lookup-source.ts` | new `RecordCollection`, `findRecordCollections` (bounded walk); `LookupSource.credentialRef` → `credentialSet: boolean`; `NewLookupSource.credential?: string \| null`; remove `LOOKUP_CREDENTIAL_ENV_PREFIX` / `isValidLookupCredentialRef` |
| domain | `ports/value-set-provider.ts` | `ValueSetProbe` becomes `{ collections: RecordCollection[] }`; `ValueSetProbeInput.credentialRef` → `credential` |
| domain | `ports/lookup-source-repository.ts` | add `readCredential(sourceId): Promise<Result<string \| null>>` |
| application | `use-cases/lookup/lookup-source.ts` | `TestLookupSource` returns `collections` and resolves the chosen one by `recordsPath`; unknown path is `VALIDATION_FAILED` |
| adapters | `lookups/value-set-kind-adapter.ts` | add `discoverCollections(input)`; `FetchRecordsInput.credentialRef` → `credential` |
| adapters | `lookups/api-value-set-provider.ts` | `discoverCollections` walks the raw body (no `recordsPath` applied); credential arrives as plaintext from the caller, not read from `process.env` |
| adapters | `lookups/managed-value-set-provider.ts`, `directory/directory-value-set-provider.ts` | `discoverCollections` returns a single root collection |
| adapters | `lookups/caching-value-set-provider.ts` | fetch the credential via `readCredential` for the `api` kind and pass it down |
| adapters | `repositories/drizzle-lookup-source-repository.ts` | encrypt on write, `readCredential` decrypts, read model carries `credentialSet` only; takes `SettingsEncryptionService` |
| adapters | `db/schema/kb.ts` | `credential_ref text` → `credential text` (encryption envelope) |
| adapters | `drizzle/0045_*.sql` | **regenerated** (delete + `drizzle-kit generate`) so snapshot and `_journal` stay consistent |
| web | `server/routers/lookup-source.ts` | `credentialSet` on read; `credential` optional on write, blank keeps existing |
| web | `components/settings/lookup-sources-card.tsx` | Records dropdown replaces the manual path input; credential becomes a password field with `•••• set` placeholder |
| web | `lib/container-lookup-sources.ts`, `lib/container.ts` | drop the env-var reader, pass the existing `settingsEncryption` service |

## 6. Implementation steps (test-first)

1. **Domain — the walk.** `findRecordCollections` over: root array, nested
   (`result.items`), several collections in one body, empty arrays, arrays of
   scalars (rejected), and a body deeper/wider than the bounds. Then implement.
2. **Domain — credential shape.** `credentialSet` on the read model,
   `credential` on the write model, the env-prefix helpers deleted; update the
   ports.
3. **Application — Test.** Returns `collections`; resolves the chosen collection
   from `recordsPath`; unknown path errors; display/key must belong to the
   chosen collection.
4. **Adapters — discovery.** `discoverCollections` per kind; the api kind walks
   the raw body.
5. **Adapters — credentials.** Repository encrypts/decrypts, `readCredential`;
   caching provider fetches and passes it; api adapter sends it as the
   `Authorization` header. Regenerate migration 0045.
6. **Web — router + card.** `credentialSet`, blank-keeps-existing, Records
   dropdown, password field.
7. **Close-out.** `./validate.sh`, move this doc to
   `implemented/alpha-3/v0.31.0/`, update the v0.31.0 implementation summary and
   ADR-050, update PR #250.

## 7. Acceptance criteria

- [ ] Test returns every array-of-records in the response with path, count,
      fields and a bounded sample; the root array is offered as `(whole response)`.
- [ ] Choosing a collection sets `recordsPath`; display/key list only that
      collection's fields; a field from another collection cannot be chosen.
- [ ] The walk is bounded in depth, breadth and per-array sampling, and a
      malformed or hostile body yields an error or an empty list, never a hang.
- [ ] An `api` source's credential is entered in the app, stored encrypted, and
      sent as the `Authorization` header.
- [ ] Saving with the credential blank keeps the stored secret; clearing it
      explicitly removes it.
- [ ] No query returns the secret; `list` exposes `credentialSet` only.
- [ ] `credential_ref` and the `LOOKUP_CRED_` namespace are gone from the
      codebase.
- [ ] Migration 0045 regenerates cleanly; validate check 22 (schema matches
      migrations) passes; still no `-- data-impact:` line required.
- [ ] Architecture boundaries intact; `./validate.sh` passes.

## 8. Risks / open questions

- The JSON walk runs over admin-supplied responses: depth, breadth and
  array-length caps are load-bearing, not cosmetic.
- `ValueSetProbe`'s shape changes, so every consumer of the port moves with it —
  compiler-caught, but the card's Test flow is rewritten around it.
- Stored credentials depend on a stable `SETTINGS_ENCRYPTION_KEY`; rotating it
  makes them undecryptable, exactly as it already does for n8n and AI keys.
- Removing the env-var indirection also removes the guard that stopped an admin
  aiming a source at `DATABASE_URL`. That risk goes with it — there is no longer
  a variable name to point anywhere — but it means the app now holds the secret,
  so the encryption-at-rest path is the control that matters.
