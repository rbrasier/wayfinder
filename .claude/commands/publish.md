# /publish — Publish Release Artifacts

Use this skill when the user asks to publish, push or ship a release artifact —
a container image today, npm packages later. `/release` hands off to it after
tagging; it is also safe to invoke on its own to retry a failed publish or to
push a throwaway image for testing a cloud deployment.

**This skill does not build anything locally.** The GitHub Actions workflow is
the mechanism, and the only credential involved is its own `GITHUB_TOKEN`. This
skill drives that workflow and reports what it produced. Never `docker push` from
a developer machine — it puts a laptop in the supply chain and produces an image
nobody can trace to a commit.

---

## Step 0 — Which artifact stream?

| Stream | Status | Publishes |
|---|---|---|
| **Container image** | Active | `ghcr.io/rbrasier/wayfinder:<version>` |
| **npm packages** | Not yet implemented | The four `@wayfinder/*` framework packages |

Today, answer "container image" without asking — it is the only stream that
ships. Ask only once npm publishing exists.

> The npm stream is dormant, not absent: `.changeset/config.json` is configured
> with `"access": "public"` and a `linked` group of the four packages, and none
> of them sets `private: true`. Shipping it needs an `NPM_TOKEN`, a
> changeset-per-PR convention, and a decision on whether framework versions track
> the app's `VERSION`. That is its own phase.

---

## Container image

### Step 1 — Establish what is being published

1. Confirm the tag exists: `git tag -l 'v*' --sort=-v:refname | head -5`
2. Confirm the tag's `VERSION` file matches the tag name. The workflow enforces
   this and fails the publish if they disagree — check first so the user finds
   out here rather than three minutes into a build.
3. Confirm CI is green on the tagged commit. **Never publish a red build.**
4. Determine whether the tag is on a release line or on `main`. A tag on a
   release line moves `latest`; a tag on `main` does not (ADR-046 §2). Tell the
   user which is about to happen.

### Step 2 — Check whether it is already published

```bash
docker manifest inspect ghcr.io/rbrasier/wayfinder:<version>
```

Published tags are **immutable**. If it already exists, say so and stop — a bad
image is replaced by a new PATCH version, never by overwriting a published tag.
Re-running this skill for an already-published tag is safe and must be a no-op.

### Step 3 — Trigger or locate the workflow run

Pushing the tag normally starts `publish.yml` on its own, so look for a run
first rather than starting a second one:

```bash
gh run list --workflow=publish.yml --limit 5
```

If the tag was pushed and no run exists — or an earlier run failed on a registry
error — dispatch one:

```bash
gh workflow run publish.yml -f tag=v<version>
```

### Step 4 — Follow it and report

Watch the run to completion. On success, report:

- The image reference: `ghcr.io/rbrasier/wayfinder:<version>`
- **The digest** — the only durable identifier; tags can in principle be moved,
  digests cannot
- Whether `latest` moved
- The pull command a deployer would run

Verify the result is actually public by inspecting the manifest without
credentials. A publish that succeeded but left the package private is a broken
publish: the deployment guides promise a credential-free pull.

On failure, report which step failed and why. Do not retry blindly — a version
mismatch and a registry outage need different responses.

### Step 5 — Re-pin the deployment guides to what's published

Skip this step for a throwaway pre-release tag (Step 0 below) — it never moves
`latest`, so the guides must keep pointing at the last real release, not at it.

`docs/guides/setup-aws.md`, `docs/guides/setup-azure.md`, and
`docs/guides/upgrading.md` pin the previous version in example commands
(`ghcr.io/rbrasier/wayfinder:<version>`, `--image wayfinder:<version>`,
`WAYFINDER_VERSION=<version>` in a `sed` example, and the `X.Y.z` upgrade-path
prose in `upgrading.md`). Find the previous version they're still pinned to and
bump every literal occurrence to the version just published:

```bash
grep -rn "wayfinder:[0-9]\|WAYFINDER_VERSION=[0-9]" docs/guides/*.md
```

A reference driven by `$(cat VERSION)` or another variable (as in
`setup-azure.md`'s `az containerapp create`) is already self-updating — leave
it alone. Only bump hardcoded literals. Commit on the same branch the tag was
cut from (`docs: pin deployment guides to v<version>`), and push directly —
this is a mechanical version bump, not a design change, so it doesn't need its
own PR. If the branch is protected and a direct push is rejected, open a PR
instead.

### Step 6 — Point at the upgrade path

Once published, remind the user that existing deployments upgrade by pointing at
the new tag and running migrations — see
[`docs/guides/upgrading.md`](../../docs/guides/upgrading.md). Nothing about a
publish updates a running deployment.

---

## Publishing a throwaway image

For testing a cloud deployment before cutting a release, publish from a branch
with a pre-release tag:

```bash
git tag v0.24.0-rc.1 && git push origin v0.24.0-rc.1
```

It never moves `latest` (it is not on a release line). Say plainly that it is
permanent and publicly visible — GHCR packages can be deleted, but not cleanly,
and the version history stays visible.

---

## Never

- Publish from a developer machine
- Overwrite a published tag
- Publish a tag whose CI is red or unfinished
- Move `latest` to an image built from `main`
- Publish a tag whose `VERSION` file disagrees with the tag name
