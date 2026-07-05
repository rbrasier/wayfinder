# Managing Releases

How Wayfinder's alpha releases work: the branches, the version numbers, how
changes flow between them, and how to cut the next alpha. If you just want to
know **where to open your PR**, the short version is in
[`CONTRIBUTING.md`](../../CONTRIBUTING.md#2-target-the-right-release) — this
guide explains the machinery behind it.

> **Not to be confused with package publishing.** This guide covers releasing
> the Wayfinder *application* (alpha-1, alpha-2, …). Publishing the
> `@rbrasier/*` framework packages to GitHub Packages is a separate process —
> see [`publishing-a-release.md`](./publishing-a-release.md).

---

## The model in one picture

```
release/alpha-1  ──o───o───o──▶   current alpha: bug fixes + enhancements (1.x.x)
                  /     \
                 /       \  (maintainers merge forward periodically)
main  ──────────o─────────o───o──▶   next alpha: new features (2.x.x = alpha-2)
```

Two long-lived branch types, nothing else:

| Branch | Role | What lands there | Version line |
|---|---|---|---|
| `release/alpha-N` | The **current** alpha, in stabilisation | Bug fixes and enhancements only | `N.x.x` |
| `main` | The **next** alpha, in active development | New features (plus fixes for things that only exist on `main`) | `N+1.x.x` |

The current alpha branch is recorded in exactly one place — the **Release
Branching** section of [`CLAUDE.md`](../../CLAUDE.md) — and the Claude Code
skills read it from there. Everything else (this guide, `CONTRIBUTING.md`)
defers to that line.

## Why this shape?

The goal is a release process a small alpha-stage project can actually
sustain:

- **Users on the current alpha get fixes without surprises.** Nothing lands
  on `release/alpha-N` except stabilisation work, so updating within an alpha
  is always safe.
- **Feature work is never blocked.** New features merge to `main`
  continuously; there is no freeze window.
- **No change lands twice.** Fixes flow *forward* automatically (see below);
  nobody cherry-picks or re-implements.
- **No extra tooling.** It's just two branches, the existing `VERSION` file,
  and git tags.

## How version numbers map to alphas

Each alpha owns one MAJOR version line: **alpha-N = `N.x.x`**. So alpha-1 is
every `1.x.x` version, alpha-2 is every `2.x.x` version, and cutting a new
alpha is what bumps MAJOR — not an arbitrary "breaking change" judgement call.

| Bump | Meaning | Happens on |
|---|---|---|
| MAJOR (`x.0.0`) | A new alpha line begins | `main`, immediately after `release/alpha-N` is cut |
| MINOR (`0.x.0`) | DB schema change, new phase, new feature | `main` (features) or `release/alpha-N` (enhancements) |
| PATCH (`0.0.x`) | Bug fix, UI tweak, no schema impact | Either branch |

Breaking API or domain changes belong to the *next* alpha — they go to
`main`, never to a release branch.

`VERSION` and root `package.json#version` must always match on every branch;
`validate.sh` enforces it. See [`versioning.md`](./versioning.md) for the doc
lifecycle that accompanies each bump.

## How changes flow

### Into a release: pull requests

Every change arrives as a PR against the branch it belongs to:

- `fix/<slug>` or `enhance/<slug>` → PR against `release/alpha-N`
- `feature/<slug>` → PR against `main`

The `/bugfix` and `/enhance` skills ask which release a change targets and
handle the branching; `/build` and `/new-feature` always work against `main`.

### Between releases: forward merges only

Maintainers periodically merge the release branch into `main`:

```bash
git checkout main && git pull
git merge release/alpha-1
git push
```

That's the *only* direction changes move between the long-lived branches.
A fix made on `release/alpha-1` reaches alpha-2 at the next forward merge —
nobody has to land it twice. Merging `main` into a release branch is
forbidden: it would pull unfinished features into the stable alpha.

If a forward merge conflicts (the same code was changed by a fix on the
release branch and a feature on `main`), resolve in favour of `main`'s shape
while preserving what the fix *does* — the fix's regression test tells you
whether you succeeded.

## CI on release branches

`ci.yml` and `e2e.yml` trigger on:

```yaml
on:
  pull_request:
    branches: [main, "release/**"]
  push:
    branches: [main, "release/**"]
```

Two things worth understanding about this:

- The `pull_request` filter matches the PR's **target** branch, not the
  branch the work lives on. A PR from `fix/whatever` into `release/alpha-1`
  runs full CI, whatever the source branch is called. Since all work arrives
  by PR, every contribution is checked before merge.
- The `push` filter covers direct commits to the long-lived branches
  themselves (merge commits, version bumps). Scratch branches without an open
  PR don't run CI — deliberately, to avoid double runs and wasted minutes on
  work-in-progress. Open the PR (draft is fine) when you want feedback.

## Maintainer runbook

### Cutting the next alpha

When `main` is feature-complete for alpha-N:

1. **Cut the branch** from the tip of `main`:

   ```bash
   git fetch origin
   git checkout -B release/alpha-N origin/main
   git push -u origin release/alpha-N
   ```

2. **Start the next line on `main`**: bump `VERSION` and root `package.json`
   to `(N+1).0.0` and commit (`chore: start alpha-(N+1)`).

3. **Update the current-alpha references**: the **Release Branching** section
   of `CLAUDE.md` (and its mirror in `AGENTS.md`), and the branch table in
   `CONTRIBUTING.md`.

4. **Retire the previous release branch**: `release/alpha-(N-1)` stops
   receiving changes — critical fixes only, at maintainer discretion.

### Publishing an alpha build

Tag the release branch at the commit you're shipping:

```bash
git checkout release/alpha-N && git pull
git tag v$(cat VERSION)
git push origin --tags
```

The tag names the exact `VERSION` being shipped (e.g. `v1.58.6`), so the
alpha number is always recoverable from the MAJOR digit.

### Forward-merge cadence

Merge `release/alpha-N` into `main` after each fix lands, or at minimum
before cutting the next alpha — a release branch that is ahead of `main` at
cut time means lost fixes.
