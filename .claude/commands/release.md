# /release — Release Management

Use this skill when a maintainer asks to cut the next alpha, tag an alpha
build, or forward-merge release fixes into `main`.

**Maintainer-only:** every operation here pushes to long-lived branches.
The full release model is documented in
[`docs/guides/managing-releases.md`](../../docs/guides/managing-releases.md).

---

## Required Clarifying Questions

Ask via `AskUserQuestion` before proceeding:

1. Which operation?
   - **Cut the next alpha** — freeze `main` into a new `release/alpha-N` branch and start the next version line
   - **Tag an alpha build** — publish a `vX.Y.Z` tag on the current alpha branch
   - **Forward-merge** — merge the current alpha branch's fixes into `main`

---

## Shared pre-flight (all operations)

- Read the current alpha branch from the **Release Branching** section of
  `CLAUDE.md` (the `Current alpha branch:` line).
- Derive the numbers from `main`: if `VERSION` on `main` is `M.x.x`, then
  `main` is alpha-M in development, the branch to cut is `release/alpha-M`,
  and `main`'s next line is `(M+1).0.0`.
- `git fetch origin` and confirm the working tree is clean. Abort if not.

---

## Operation A — Cut the next alpha

### Step 1 — Verify main is ready

- CI must be green on the head of `main` (check the latest run via
  `mcp__github__actions_list` / `actions_get`).
- No fix left behind: `git log origin/<current-alpha-branch> --not origin/main --oneline`
  must be empty. If it isn't, run **Operation C** first, then return here.

### Step 2 — Confirm the plan

Echo to chat: the branch to be created (`release/alpha-M`), `main`'s new
version (`(M+1).0.0`), and the files that will be updated. Then confirm via
`AskUserQuestion` before touching anything.

### Step 3 — Cut the release branch

```bash
git checkout -B release/alpha-M origin/main
git push -u origin release/alpha-M
```

### Step 4 — Start the next line on main

On a working branch off `main` (`release-prep/alpha-(M+1)`):

- Set `VERSION` and root `package.json` `version` to `(M+1).0.0`
- Update the `Current alpha branch:` line in `CLAUDE.md` **and** `AGENTS.md`
  to `release/alpha-M`
- Update the branch table in `CONTRIBUTING.md` §2 (branch name and version
  lines)
- Run `./validate.sh` (the version-sync check must pass)
- Commit (`chore: start alpha-(M+1)`), push, and open a PR against `main`
  via `mcp__github__create_pull_request`

### Step 5 — Report

State: the new current alpha branch, `main`'s new version line, and the link
to the version-bump PR. Remind the user the previous release branch is now
retired (critical fixes only).

---

## Operation B — Tag an alpha build

1. `git checkout <current-alpha-branch> && git pull`
2. Verify CI is green on the branch head — never tag a red build.
3. Tag the exact version being shipped and push it:

   ```bash
   git tag v$(cat VERSION)
   git push origin v$(cat VERSION)
   ```

4. Offer to create a GitHub Release for the tag, summarising changes since
   the previous tag on the branch (`git log <previous-tag>..HEAD --oneline`).

---

## Operation C — Forward-merge the alpha into main

1. `git checkout main && git pull && git merge origin/<current-alpha-branch>`
2. Resolve conflicts in favour of `main`'s shape while preserving what each
   fix *does* — the fix's regression tests must still pass.
3. Run `./validate.sh` and fix all failures.
4. Push `main` (or open a PR if `main` is protected and direct push fails).
5. Never merge in the other direction — `main` must not be merged into a
   release branch.
