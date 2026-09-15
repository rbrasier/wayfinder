# Managing Releases

How Wayfinder's releases work: the branches, the version numbers, how changes
flow between them, and how to cut the next release line. If you just want to
know **where to open your PR**, the short version is in
[`CONTRIBUTING.md`](../../CONTRIBUTING.md#2-target-the-right-release) — this
guide explains the machinery behind it.

---

## The model in one picture

```
release/alpha-2  ──o───o───o──▶   current line: bug fixes + enhancements (0.19.x)
                  /     \
                 /       \  (maintainers merge forward periodically)
main  ──────────o─────────o───o──▶   next line: new features (0.20.0 → , = alpha-3)
```

Two long-lived branch types, nothing else:

| Branch | Role | What lands there |
|---|---|---|
| `release/<line>` | The **current** release line, in stabilisation | Bug fixes and enhancements only |
| `main` | The **next** release line, in active development | New features (plus fixes for things that only exist on `main`) |

The current release branch and the next line's name are recorded in exactly one
place — the **Release Branching** section of [`CLAUDE.md`](../../CLAUDE.md) —
and the Claude Code skills read them from there. Everything else (this guide,
`CONTRIBUTING.md`) defers to those two lines.

## Release stages

Wayfinder moves through three stages. The stage lives in the **branch name**,
never in the version number:

| Stage | Branch | What it means |
|---|---|---|
| Alpha | `release/alpha-N` | Feature-incomplete, breaking changes expected between lines |
| Beta | `release/beta-N` | Feature-complete for `1.0`, stabilising, no new features |
| Stable | `release/1.x` | The first supported release. Cut from the last beta as `1.0.0` |

Cutting a line is a branch operation. It does not bump the version by itself —
see below.

## Why this shape?

The goal is a release process a small alpha-stage project can actually
sustain:

- **Users on the current line get fixes without surprises.** Nothing lands
  on the release branch except stabilisation work, so updating within a line
  is always safe.
- **Feature work is never blocked.** New features merge to `main`
  continuously; there is no freeze window.
- **No change lands twice.** Fixes flow *forward* automatically (see below);
  nobody cherry-picks or re-implements.
- **No extra tooling.** It's just two branches, the existing `VERSION` file,
  and git tags.

## How version numbers work

Wayfinder is pre-release, so it follows semver's pre-1.0 rule: **MAJOR stays
`0` until the first stable release**. Every version is `0.MINOR.PATCH`.

| Bump | Meaning | Happens on |
|---|---|---|
| MAJOR (`x.0.0`) | Reserved — `0` → `1.0.0` exactly once, at the first stable release | The `release/1.x` branch, at cut time |
| MINOR (`0.x.0`) | DB schema change, new phase, new feature | `main` (features) or the release branch (enhancements) |
| PATCH (`0.0.x`) | Bug fix, UI tweak, no schema impact | Either branch |

**The line name is not in the version.** Alpha-3 is not "the 3.x line" — it is
whatever versions happen to land on `main` while `alpha-3` is the next line.
MINOR counts up continuously, so numbers never restart and always sort.

This is a deliberate change from the original model, where each alpha owned a
MAJOR line (alpha-1 = `1.x.x`, alpha-2 = `2.x.x`). That put the project on
`2.x` while it was still alpha, which is the opposite of what MAJOR means. The
old numbers are preserved in the historical docs folders and mapped in
[`versioning.md`](./versioning.md#version-history); nothing was ever tagged or
published under them.

Breaking API or domain changes belong to the *next* line — they go to `main`,
never to a release branch.

`VERSION` and root `package.json#version` must always match on every branch;
`validate.sh` enforces it. See [`versioning.md`](./versioning.md) for the doc
lifecycle that accompanies each bump.

## How changes flow

### Into a release: pull requests

Every change arrives as a PR against the branch it belongs to:

- `bugfix/<slug>/claude-<username>` or `enhance/<slug>/claude-<username>` → PR against the current release branch
- `feature/<slug>/claude-<username>` → PR against `main`

Branch names are `<changetype>/<slug>/claude-<username>`: the type of change, a
short kebab-case description, and the author's GitHub login.

The `/bugfix` and `/enhance` skills ask which release a change targets and
handle the branching; `/build` and `/new-feature` always work against `main`.

### Between releases: forward merges only

Maintainers periodically merge the release branch into `main`:

```bash
git checkout main && git pull
git merge release/alpha-2
git push
```

That's the *only* direction changes move between the long-lived branches.
A fix made on `release/alpha-2` reaches the next line at the next forward merge —
nobody has to land it twice. Merging `main` into a release branch is
forbidden: it would pull unfinished features into the stabilising line.

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
  branch the work lives on. A PR from `bugfix/whatever/claude-someone` into `release/alpha-2`
  runs full CI, whatever the source branch is called. Since all work arrives
  by PR, every contribution is checked before merge.
- The `push` filter covers direct commits to the long-lived branches
  themselves (merge commits, version bumps). Scratch branches without an open
  PR don't run CI — deliberately, to avoid double runs and wasted minutes on
  work-in-progress. Open the PR (draft is fine) when you want feedback.

## Maintainer runbook

The `/release` skill (`.claude/commands/release.md`) automates all three
operations below — it asks which stage the new line is, runs the pre-flight
checks, and updates every current-line reference. The manual steps are kept
here so the skill's behaviour is auditable.

### Cutting the next release line

When `main` is feature-complete for the current line:

1. **Decide the stage** — another alpha, the first beta, or the stable release.
   That decision picks the branch name and, for stable only, the version:

   | Stage | New branch | Version on the new branch |
   |---|---|---|
   | Alpha | `release/alpha-(N+1)` | unchanged — whatever `main` was at |
   | Beta | `release/beta-1` (or `beta-(N+1)`) | unchanged |
   | Stable | `release/1.x` | `1.0.0` |

2. **Cut the branch** from the tip of `main`:

   ```bash
   git fetch origin
   git checkout -B release/<line> origin/main
   git push -u origin release/<line>
   ```

3. **Set the version on the new branch** only when cutting stable (`1.0.0`).
   Alpha and beta lines inherit `main`'s current version and carry on from
   there with PATCH bumps.

4. **`main` carries on.** Its version is *not* bumped at cut time — the next
   feature to land bumps MINOR as usual. This is the main departure from the
   old model, where cutting a line forced a MAJOR bump.

5. **Update the current-line references**: the **Release Branching** section of
   `CLAUDE.md` (both the `Current release branch` and `Next release line`
   lines, and its mirror in `AGENTS.md`), the branch table in
   `CONTRIBUTING.md`, and the **Quickstart** in `README.md` (the "Current
   release" line and the `git clone --branch` argument).

6. **Create the next line's docs folder**:
   `docs/development/implemented/<next line>/`.

7. **Retire the previous release branch**: it stops receiving changes —
   critical fixes only, at maintainer discretion.

### Publishing a build

Tag the release branch at the commit you're shipping:

```bash
git checkout release/<line> && git pull
git tag v$(cat VERSION)
git push origin --tags
```

The tag names the exact `VERSION` being shipped (e.g. `v0.19.4`). Because the
stage is no longer encoded in the digits, note the line in the GitHub Release
title (e.g. "v0.19.4 — alpha-2").

### Publishing the container image

Pushing a `v*` tag starts `.github/workflows/publish.yml`, which builds and
pushes `ghcr.io/rbrasier/wayfinder:<version>` publicly. The workflow refuses to
publish a tag whose `VERSION` file disagrees with the tag name, and it moves
`latest` only for a tag on a release line — never for one on `main`.

**`/release` never publishes inline.** It offers to hand off to **`/publish`**
after tagging. A registry failure part-way through a release would otherwise
leave a pushed tag with no image and no clean way to resume; `/publish` is
separately re-runnable and safe to retry for the same tag.

Published tags are immutable. A bad image gets a new PATCH version — it is never
replaced in place. Deployers upgrade by pointing at the new tag and running
migrations as their own step, per [`upgrading.md`](upgrading.md).

### Forward-merge cadence

Merge the release branch into `main` after each fix lands, or at minimum
before cutting the next line — a release branch that is ahead of `main` at
cut time means lost fixes.
