# Bug Fix: template scaffolding is still live, and the package scope rename was never finished

## Symptom

Wayfinder was cloned from `ai-app-template` and still carries that template's
bootstrap machinery, wired into the root `package.json` as runnable scripts:

- `pnpm run init` (`scripts/init-project.sh`) does `rm -rf packages/`, rewrites
  the apps' `workspace:*` dependencies to registry version ranges, deletes
  `.git` and re-inits it. The only thing stopping it is a guard on the first
  four lines: `if [ -f .framework-scope ]; then exit 0`. Delete that one
  dotfile — or run the script in a checkout that never had it — and the command
  destroys `packages/` and the repository history.
- `pnpm run framework:update` (`scripts/update-framework.sh`) advertises
  updating `@rbrasier/*` from GitHub Package Registry. It cannot ever do
  anything: the packages are workspace links, so `pnpm outdated` returns
  nothing and the script always exits at *"Already on the latest framework
  version."*
- `docs/guides/updating-the-framework.md` documents that dead workflow as if it
  were live.

Separately, ADR-003 states the `@rbrasier/*` scope is a template placeholder and
that the bootstrap renames it to the project's real scope. That rename ran for
the apps — they are `@wayfinder/web` and `@wayfinder/api` — and never ran for
`packages/*`, which still sit under a personal handle.

## Reproduction

1. `rm .framework-scope` (or clone the repo in a way that drops untracked
   dotfiles) then run `pnpm run init` — the guard passes and the script
   proceeds to `rm -rf packages/`.
2. `pnpm run framework:update` on a clean tree — prints
   *"Already on the latest framework version (1.0.3)."* and exits 0, on every
   invocation, forever. `1.0.3` is itself wrong; the packages declare `1.1.0`.
3. `cat .template-version` → `1.0.3`, while
   `packages/domain/package.json` → `"version": "1.1.0"`. The tracking file has
   been stale for some time and nothing detects it.
4. `grep -rl '@rbrasier' packages apps | wc -l` → 675 source files under a scope
   that ADR-003 says should have been renamed at bootstrap.

## Root Cause (verified)

Two independent causes, both traceable to an incomplete bootstrap.

### 1. The template's detach path was never exercised, and its residue was never removed

`scripts/init-project.sh` is a one-shot bootstrap: it converts the template's
in-repo framework packages into published npm dependencies and removes the
source. Wayfinder ran it **partially** — the evidence is in the tree:

- It renamed the app packages (`apps/web/package.json` → `@wayfinder/web`,
  `apps/api/package.json` → `@wayfinder/api`), which the script does at
  `init-project.sh:182-184`.
- It wrote the two tracking files, which the script does last, at
  `init-project.sh:257-259` — hence `.framework-scope` and `.template-version`
  exist.
- It did **not** remove `packages/` or swap the apps to versioned ranges. Every
  `@rbrasier/*` entry in `pnpm-lock.yaml` resolves as
  `version: link:../../packages/<name>`, and there is no registry tarball entry
  for the scope anywhere in the lock's `packages:` section.

So the repo ended in a state the template does not model: framework source
in-tree, marker files claiming a detached project. Nothing reconciles the two,
which is why `.template-version` drifted to a lie and the update script became
unreachable code.

### 2. Two further code paths exist only to serve the detached mode that never happened

- `restart.sh:239-271` branches on `if [ -f packages/adapters/package.json ]`.
  The `else` arm is the detached path — it reads `.framework-scope` and calls
  `runMigrations()` from an npm-installed `@rbrasier/adapters`. Because
  `packages/adapters/package.json` is committed and always present, that arm is
  unreachable.
- `validate.sh` section 14 exists solely to assert that unreachable arm still
  calls `runMigrations` (`grep -q "runMigrations" restart.sh`). It guards dead
  code, and passes whether or not the code works.

### Why the rename is safe to do now

Module resolution for `@rbrasier/*` runs entirely through pnpm workspace links
plus each package's own `main`/`types`/`exports`, which point directly at `.ts`
source. Confirmed absent:

- no `paths` mapping in `tsconfig.base.json` or any package `tsconfig.json`
- no bundler alias in the Next.js or esbuild configs
- no registry resolution in `pnpm-lock.yaml`

There is therefore no indirection that could mask a missed specifier — anything
overlooked fails `pnpm typecheck` immediately, rather than resolving to a stale
package at runtime.

## Fix Plan

### Remove the template residue

| Path | Action |
|---|---|
| `scripts/init-project.sh` | delete |
| `scripts/update-framework.sh` | delete |
| `.framework-scope` | delete |
| `.template-version` | delete |
| `docs/guides/updating-the-framework.md` | delete |
| `package.json` | drop the `init` and `framework:update` scripts |
| `restart.sh` | drop the unreachable scaffolded-mode `else` arm and its `if` guard; call `pnpm --filter` unconditionally |
| `validate.sh` | drop section 14, which guarded only that arm |

### Finish the scope rename

`@rbrasier/*` → `@wayfinder/*` across:

- the four `packages/*/package.json` `name` fields and their cross-package
  `dependencies`
- 675 source files (`packages/*`, `apps/web`, `apps/api`)
- `eslint.config.mjs`, `validate.sh`, `.github/workflows/ci.yml`,
  `.changeset/config.json`, `Dockerfile`
- `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`,
  `.github/pull_request_template.md`, `.claude/commands/publish.md`
- the 14 live docs (ADRs 001/002/003/014/023/047, three PRDs, four guides)

`pnpm-lock.yaml` is regenerated with `pnpm install`, never hand-edited.

**Not renamed:** the 33 files under `docs/development/implemented/alpha-1/`.
They record what was true at the time of those releases; rewriting them would
make the historical record false. ADR-003 gains a note stating the rename it
anticipated has now happened.

**Two files need care.** `packages/application/src/use-cases/session/retrieve-document-chunks.ts`
and `packages/adapters/src/directory/graph-client.ts` contain literal NUL bytes,
used as a delimiter in a template literal (`` `${a}\0${b}` ``). grep classifies
them as binary and skips them in a `grep -rl | xargs sed` pipeline, so the
rename is driven from `find`, and the NUL bytes are verified byte-for-byte
afterwards.

### Guard both against recurrence

New `validate.sh` section 26, sitting with sections 5, 17, 18, 20 and 23, which
enforce the same class of repo-wide rule. It fails if either:

- `@rbrasier` appears anywhere outside `docs/development/implemented/`, or
- any of the five deleted template files reappears.

This is the regression guard. It fails on the tree as it stands today and
passes once the fix lands.

### Out of scope

- `packages/*` keep their own `1.1.0` version fields, unaligned with the root
  `0.35.0`. Meaningless for workspace-only packages that are never published,
  but changing them is a separate decision.
- `mocks` keeps its `@wayfinder-mocks/root` name.
- No change to `release/alpha-2` and no backport — this lands on `main` only.

## Version

PATCH: `0.35.0` → `0.35.1`. No schema change, no migration, no product
behaviour change.

---

## Implementation Summary

**Version:** 0.35.0 → 0.35.1 (PATCH). Base branch `main`. `release/alpha-2`
untouched, no backport.

### Root cause

Two causes, both from an `ai-app-template` bootstrap that ran partially. The
template's detach script renamed `apps/*` and wrote its two marker files, but
never removed `packages/` or converted the apps to registry dependencies — so
the repo held framework source in-tree while its marker files claimed a
detached project. Nothing reconciled the two: `.template-version` drifted to
`1.0.3` against packages declaring `1.1.0`, `update-framework.sh` became
unreachable, and `init-project.sh` stayed runnable as `pnpm run init` with a
`rm -rf packages/` behind a single-dotfile guard. The `packages/*` half of the
scope rename ADR-003 mandated was simply never done.

### Fix applied

**Removed**
- `scripts/init-project.sh`, `scripts/update-framework.sh`, `.framework-scope`,
  `.template-version`, `docs/guides/updating-the-framework.md`
- `package.json` — the `init` and `framework:update` scripts
- `.gitignore` — the negation entries for the two deleted marker files
- `restart.sh` — the unreachable scaffolded-mode `else` arm and its `if [ -f
  packages/adapters/package.json ]` guard; migration now runs unconditionally
  through `pnpm --filter`. Also corrected a comment describing database
  creation as happening in a "create package" that does not exist
- `validate.sh` — section 14, which existed only to guard that arm. The 13 → 15
  gap is left as-is, matching the existing 23 → 25 gap; renumbering would churn
  every section below it for no gain

**Renamed** `@rbrasier/*` → `@wayfinder/*` across 707 files: the four
`packages/*/package.json` names and their cross-package dependencies, all
source imports in `packages/*` and `apps/*`, `eslint.config.mjs`, `validate.sh`,
`.github/workflows/ci.yml`, `.changeset/config.json`, `Dockerfile`, both app
`CHANGELOG.md` files, `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`,
`.github/pull_request_template.md`, `.claude/commands/publish.md`, and the 14
live docs. `pnpm-lock.yaml` was regenerated with `pnpm install`; its diff is the
rename plus alphabetical re-sorting, with no dependency version changed.

The sweep was driven from `find` and applied as a byte-level replace, because
`packages/application/src/use-cases/session/retrieve-document-chunks.ts` and
`packages/adapters/src/directory/graph-client.ts` contain literal NUL bytes that
make grep treat them as binary and skip them silently. Both files were verified
to still hold their 3 NUL bytes afterwards.

**Docs corrected beyond a rename**, because deleting the scripts left them
describing things that no longer exist:
- `docs/guides/setup-end-user.md` — was a guide to bootstrapping a *different*
  project from the template, citing `npx @rbrasier/create` (a CLI that does not
  exist in this repo) and `pnpm run init`. Rewritten as Wayfinder's local
  development setup, keeping the env/infra/run sections that were already
  correct
- `docs/guides/setup-admin.md` — retitled off "Template Maintainer"; the clone
  URL pointed at `ai-app-template`
- `docs/guides/overriding-adapters.md` — told the reader to copy adapter source
  out of `node_modules/`, which only made sense in a detached project, and
  promised "framework updates" that no longer exist
- ADR-003 — the "Why this scope?" rationale still described a template
  placeholder. Replaced, with an amendment note recording what changed in
  v0.35.1 and why `implemented/` was left alone

### Regression test

`validate.sh` section 26 — fails if any of the five deleted template files
reappears, or if the old scope shows up anywhere outside
`docs/development/implemented/`. Confirmed failing before the fix (listing all
five files and 707 scope hits) and passing after. Its search pattern brackets
the first letter (`@[r]brasier`) so the script does not match itself.

No unit test: nothing here is package-level logic. This is a repo-structure
rule, and sections 5, 17, 18, 20 and 23 already enforce that class of rule the
same way.

### E2E

None. No behaviour reaches a browser — no auth lifecycle, streaming, file
transfer, navigation state, accessibility or smoke behaviour changes, so this
falls into none of the six groups in `docs/guides/e2e-test-policy.md`.

### Verification

`pnpm typecheck` passes across all six packages, which is the load-bearing
check: with no tsconfig path aliases and no bundler alias, a missed specifier
cannot resolve to anything. `pnpm lint` reports 0 errors, `pnpm test` passes 7/7
task groups. `./validate.sh` passes 24 of 25 applicable sections.

### Known limitations

- `./validate.sh` section 11 (`pnpm audit`) fails on upstream advisories in
  `next`, `sharp`, `js-yaml`, `@xmldom/xmldom` and `nodemailer`. Verified
  byte-identical on clean `main` before this branch — pre-existing, unrelated,
  and left for separate dependency work.
- `packages/*` keep their inherited `1.1.0` version fields, unaligned with the
  root `0.35.1`. Meaningless for workspace-only packages that are never
  published, but changing them is a separate decision.
- The 33 files under `docs/development/implemented/alpha-1/` still show the old
  scope, deliberately.
