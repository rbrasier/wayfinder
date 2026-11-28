# Forward merge: `release/alpha-3` (PRs #407–#411) into `main` (v0.41.14)

## Approved change summary

Periodic forward merge of `release/alpha-3` into `main`, as described in
[`managing-releases.md`](../../../../guides/managing-releases.md) and `/release`
Operation C. Shipped as a patch bump so the merge-back can be traced like a bugfix.

## What came across

Everything on `release/alpha-3` since the previous forward merge (v0.41.12,
PR #406, which took the release line up to PR #405):

| Release-line change | Release PR | Release version | Trace doc on `release/alpha-3` |
|---|---|---|---|
| **Dependabot Docker bumps**: `eclipse-temurin` 24.0.2_12-jdk-noble and `maven` 3.9-eclipse-temurin-26 in the `Dockerfile` signature-engine stages | #407, #408 | 0.41.11 | — (Dependabot) |
| **validate.sh check 26 skips gitignored files**: the old-scope scan moves to `scripts/find-template-scope-leaks.sh` (`git grep --untracked`), with `scripts/find-template-scope-leaks.test.mjs` as its regression test | #410 | 0.41.11 | [`alpha-3/v0.41.11/validate-residue-gitignored.bugfix.md`](../../alpha-3/v0.41.11/validate-residue-gitignored.bugfix.md) |
| **Faster container image CI job**: the `compose-smoke` job folds into `docker-image` and runs against the scanned image; `.dockerignore` excludes `.cache`, `trivy_envs.txt`, `trivyignores`, `*.cdx.json` and `trust` so the -slim build hits the cache | #411 | 0.41.12 | [`alpha-3/v0.41.12/ci-image-job-speedup.enhancement.md`](../../alpha-3/v0.41.12/ci-image-job-speedup.enhancement.md) |
| **Actions group bump** (`pnpm/action-setup` 6.1.1, `actions/dependency-review-action` 5.0.1) and **bundled web fonts**: Figtree and JetBrains Mono load through `next/font/local` from `apps/web/src/app/fonts/` instead of `next/font/google`, so `next build` no longer depends on reaching Google Fonts | #409 | 0.41.13 | [`alpha-3/v0.41.13/actions-group-and-bundled-fonts.dependabot.md`](../../alpha-3/v0.41.13/actions-group-and-bundled-fonts.dependabot.md) |

The release line's trace docs come across unchanged, in the place they were
written. This file is the record of the merge on `main`.

## Integrity of `main`

Since PR #405, `main` had changed only by the v0.41.12 forward merge itself, and
none of the files the release line touched. Git merged everything cleanly except
`VERSION` and the root `package.json` version line, which both sides had bumped;
those were resolved to 0.41.14. Checked against `main`:

- **Migrations.** None in this range. The journal is unchanged, so
  `release-line-reconciliation.ts` needs no entry.
- **No stale references.** Nothing on `main` still imports `next/font/google`
  (outside the assertion in `fonts.test.ts`), and no workflow or doc outside
  `implemented/` refers to the removed `compose-smoke` job.
- **ADR / PRD numbering.** No new ADRs or PRDs, so nothing can collide.
- **Behaviour.** The fonts keep the same CSS variables, so no styles change. The
  CI change moves checks between jobs without dropping any assertion.

## Deliberately not taken

Nothing. Every commit applies to `main` as it is.

## Version

0.41.12 → **0.41.14** (patch). 0.41.13 is already used by the release line
(#409), so `main` skips it to stay above the release branch and keep every
version unique. `VERSION` and `package.json` match.

## Follow-up for the maintainer

- From #411: if branch protection on `main` lists **Compose stack smoke test**
  as a required check, remove it. That check no longer reports; its assertions
  now run inside **Build container image**.
