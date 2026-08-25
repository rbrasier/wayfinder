# /release — Release Management

Use this skill when a maintainer asks to cut the next release line, tag a
build, or forward-merge release fixes into `main`.

**Maintainer-only:** every operation here pushes to long-lived branches.
The full release model is documented in
[`docs/guides/managing-releases.md`](../../docs/guides/managing-releases.md).

---

## Required Clarifying Questions

Ask via `AskUserQuestion` before proceeding:

1. Which operation?
   - **Cut the next release line** — freeze `main` into a new `release/*` branch
   - **Tag a build** — publish a `vX.Y.Z` tag on the current release branch
   - **Forward-merge** — merge the current release branch's fixes into `main`

If the answer is **Cut the next release line**, ask a second question in the
same call:

2. Which stage is the new line?
   - **Another alpha** — still feature-incomplete. New branch `release/alpha-(N+1)`
   - **First beta** — feature-complete for `1.0`, stabilising. New branch `release/beta-1`
   - **Stable release** — the first supported release. New branch `release/1.x`, version `1.0.0`

---

## Shared pre-flight (all operations)

- Read both pointers from the **Release Branching** section of `CLAUDE.md`:
  the `Current release branch:` line and the `Next release line:` line.
- `git fetch origin` and confirm the working tree is clean. Abort if not.

**Versions do not encode the stage.** Wayfinder is on `0.MINOR.PATCH` until its
first stable release; the alpha/beta number lives in the branch name and the
`docs/development/implemented/<line>/` folder. Never derive a branch name from
a version digit, or a version from a branch name — the one exception is cutting
stable, which sets `1.0.0`.

---

## Operation A — Cut the next release line

Throughout, `<new line>` is the name from question 2 (`alpha-3`, `beta-1`,
`1.x`) and `<next line>` is the one after it — what `main` becomes.

### Step 1 — Verify main is ready

- CI must be green on the head of `main` (check the latest run via
  `mcp__github__actions_list` / `actions_get`).
- No fix left behind: `git log origin/<current release branch> --not origin/main --oneline`
  must be empty. If it isn't, run **Operation C** first, then return here.

### Step 2 — Confirm the plan

Echo to chat: the branch to be created (`release/<new line>`), the version each
branch will carry, the new `Next release line` value, and the files that will
be updated. Then confirm via `AskUserQuestion` before touching anything.

### Step 3 — Cut the release branch

```bash
git checkout -B release/<new line> origin/main
git push -u origin release/<new line>
```

For a **stable** cut only, set `VERSION` and root `package.json` to `1.0.0` on
the new branch and push that commit. Alpha and beta lines inherit `main`'s
current version and continue from there with PATCH bumps.

### Step 4 — Update main

On a working branch off `main` (`release-prep/<next line>`):

- **Do not bump `VERSION`** as part of the cut. `main` keeps the version it had;
  the next feature to land bumps MINOR as usual. Bump only if this PR itself
  carries a change that warrants one.
- Update **both** pointer lines in `CLAUDE.md` and `AGENTS.md`:
  `Current release branch:` → `release/<new line>`, and
  `Next release line (on main):` → `<next line>`
- Update the branch table and diagram in `CONTRIBUTING.md` §2
- Update the **Quickstart** section of `README.md`: the "Current release" line
  and the `--branch` argument of the `git clone` command must both point at
  `release/<new line>`
- Create the next line's docs folder:
  `docs/development/implemented/<next line>/` (add a `.gitkeep` so git tracks it)
- Add a row to the **Version history** table in `docs/guides/versioning.md`
  recording the version range the line just cut actually shipped
- Run `./validate.sh` (the version-sync check must pass)
- Commit (`chore: open the <next line> line`), push, and open a PR against
  `main` via `mcp__github__create_pull_request`
- **Write the PR body into
  [`.github/pull_request_template.md`](../../.github/pull_request_template.md)**
  — the same four sections every other PR uses. A line cut has no product
  change, so most of them carry a reason line rather than content:
  - `## Summary` — which line is being frozen, which branch now carries it,
    and the new `Next release line` value
  - `## Impact` → Features affected — "None — release-line bookkeeping".
    Business rules changed — "None — no product code touched"
  - `## UI Impact` — "None — no application change"
  - `## Why this change is required` — why this line is being cut now: what
    `main` has accumulated that warrants stabilising, and what the retiring
    line is being closed to (critical fixes only)
  - Implementation block — the pointer files updated (`CLAUDE.md`,
    `AGENTS.md`, `CONTRIBUTING.md` §2, `README.md` Quickstart), the new docs
    folder, the `versioning.md` history row, and whether `VERSION` moved

### Step 5 — Report

State: the new current release branch, the new `Next release line` value, and
the link to the PR. Remind the user the previous release branch is now retired
(critical fixes only).

Then offer **`/publish`** for a first image on the new line. Cutting a line does
not tag anything by itself, so this is a secondary offer — take it only if the
user wants a published artifact for the new line straight away.

---

## Operation B — Tag a build

1. `git checkout <current release branch> && git pull`
2. Verify CI is green on the branch head — never tag a red build.
3. Tag the exact version being shipped and push it:

   ```bash
   git tag v$(cat VERSION)
   git push origin v$(cat VERSION)
   ```

4. Offer to create a GitHub Release for the tag, summarising changes since
   the previous tag on the branch (`git log <previous-tag>..HEAD --oneline`).
   Because the version no longer encodes the stage, title the release
   `vX.Y.Z — <line>` (e.g. `v0.19.4 — alpha-2`).

5. **Offer to publish the container image**, then hand off to **`/publish`**.

   Pushing the tag starts `publish.yml` on its own, so this is usually a matter
   of following the run rather than starting one — but ask, because a tag whose
   image was never published is a release nobody can deploy.

   Do **not** publish inline from this skill. A registry failure part-way
   through `/release` would leave a release half-finished, with a pushed tag and
   no image and no obvious way back in. `/publish` is separately re-runnable and
   safe to retry, which is the whole reason it is its own skill.

---

## Operation C — Forward-merge the release branch into main

1. `git checkout main && git pull && git merge origin/<current release branch>`
2. Resolve conflicts in favour of `main`'s shape while preserving what each
   fix *does* — the fix's regression tests must still pass.
3. Run `./validate.sh` and fix all failures.
4. Push `main` (or open a PR if `main` is protected and direct push fails —
   its body uses [`.github/pull_request_template.md`](../../.github/pull_request_template.md)
   like any other, with `## Summary` naming the fixes being carried across,
   `## Impact` and `## UI Impact` aggregating what those fixes changed on the
   release line, and `## Why this change is required` stating that `main` must
   not regress behind the release branch).
5. Never merge in the other direction — `main` must not be merged into a
   release branch.
