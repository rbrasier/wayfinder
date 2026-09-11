# /publish — Tag, Release & Publish

Use this skill when the user asks to publish, push or ship a release artifact —
a container image today, npm packages later. It does the whole shipping flow in
one command: **tag the build, create its GitHub Release with notes, publish the
container image, fill in the digest, and re-pin the deployment guides.** Invoke
it on its own to ship the current release branch, to retry a failed publish, or
to push a throwaway image for testing a cloud deployment.

Every step is **idempotent** — if the tag, the Release, or the image already
exists, the skill detects it and moves on rather than duplicating or overwriting.
Re-running it on a fully-shipped version is a safe no-op.

**This skill does not build anything locally.** The GitHub Actions workflow is
the mechanism, and the only credential involved is its own `GITHUB_TOKEN`. This
skill drives that workflow and reports what it produced. Never `docker push` from
a developer machine — it puts a laptop in the supply chain and produces an image
nobody can trace to a commit.

> **Relationship to `/release`.** Cutting a new release *line* and forward-merging
> fixes into `main` still belong to `/release`. Tagging + releasing + publishing a
> build now live here, so `/release` no longer tags builds itself — it hands off
> to this skill.

---

## Step 0 — Which artifact stream?

| Stream | Status | Publishes |
|---|---|---|
| **Container image** | Active | `ghcr.io/rbrasier/wayfinder:<version>` |
| **npm packages** | Not yet implemented | The four `@rbrasier/*` framework packages |

Today, answer "container image" without asking — it is the only stream that
ships. Ask only once npm publishing exists.

> The npm stream is dormant, not absent: `.changeset/config.json` is configured
> with `"access": "public"` and a `linked` group of the four packages, and none
> of them sets `private: true`. Shipping it needs an `NPM_TOKEN`, a
> changeset-per-PR convention, and a decision on whether framework versions track
> the app's `VERSION`. That is its own phase.

---

## Container image

### Step 1 — Establish what is being shipped

Read the `Current release branch:` pointer from the **Release Branching** section
of `CLAUDE.md`. Then:

1. `git fetch origin --tags` and confirm the working tree is clean. Abort if not.
2. Be on the branch you intend to ship (the current release branch for a real
   release; the feature branch for a throwaway RC — see the bottom section). The
   version comes from `cat VERSION`; do not accept a version argument that
   disagrees with the file.
3. Confirm `VERSION` and root `package.json` `version` match — the publish
   workflow enforces `tag == VERSION` and fails the build if they disagree, so
   catch it here rather than three minutes into a build.
4. Confirm CI is green on the branch head. **Never ship a red or unfinished
   build.**
5. Determine whether this is a release-line build or a `main`/pre-release build.
   A tag on a release line moves `latest`; a tag on `main` or a pre-release tag
   does not (ADR-046 §2). Tell the user which is about to happen.

### Step 2 — Tag the build

Check whether the tag already exists first — it may if a previous run of this
skill got part-way, or if someone tagged by hand:

```bash
git tag -l "v$(cat VERSION)"; git ls-remote --tags origin "v$(cat VERSION)"
```

If it exists, skip to Step 3. Otherwise tag the exact version and push it —
pushing the tag is what starts `publish.yml`:

```bash
git tag v$(cat VERSION)
git push origin v$(cat VERSION)
```

### Step 3 — Create the GitHub Release with notes

Skip if a Release already exists for the tag (`gh release view v$(cat VERSION)`).
Otherwise summarise changes since the previous tag on the branch:

```bash
git log <previous-tag>..HEAD --oneline --no-merges
```

Group into **Features** and **Fixes**, and fold pure test/CI/docs churn into a
single trailing line rather than listing every commit. Because the version no
longer encodes the stage, title the Release `vX.Y.Z — <line>` (e.g.
`v0.28.21 — alpha-2`, line read from the current release branch name).

Match the established body shape — check the previous Release with
`gh release view <previous-tag>`: a lead line naming the release line, the image
reference, the digest, the `docker pull` command, `## Highlights`
(Features / Fixes), an `## Upgrading` line pointing at `upgrading.md`, and a
`**Full changelog:**` compare link. **The digest is not known yet** — the image
has not been built — so write the digest line as a placeholder
(`_to be filled once the image finishes publishing_`) and fill it in Step 5.

Write the body to a scratch file, then:

```bash
gh release create v$(cat VERSION) --title "v$(cat VERSION) — <line>" \
  --notes-file <notes> --latest
```

Pass `--latest` only for a release-line build (it moves the "Latest" badge,
mirroring how a release-line tag moves the `latest` image). For a tag on `main`
or a throwaway pre-release, use `--latest=false`.

### Step 4 — Locate or trigger the publish run

Pushing the tag normally starts `publish.yml` on its own, so look for a run
first rather than starting a second one:

```bash
gh run list --workflow=publish.yml --limit 5
```

If the tag was pushed and no run exists — or an earlier run failed on a registry
error — dispatch one:

```bash
gh workflow run publish.yml -f tag=v$(cat VERSION)
```

Published tags are **immutable**. If the image already exists
(`docker manifest inspect ghcr.io/rbrasier/wayfinder:$(cat VERSION)`), say so and
do not re-dispatch — a bad image is replaced by a new PATCH version, never by
overwriting a published tag.

### Step 5 — Follow it, report, and fill in the digest

Watch the run to completion (`gh run watch <id> --exit-status`). On success:

1. Get the digest and **verify the image is public** by inspecting it without
   credentials — a publish that left the package private is a broken publish, as
   the deployment guides promise a credential-free pull:

   ```bash
   docker buildx imagetools inspect ghcr.io/rbrasier/wayfinder:$(cat VERSION)
   ```

2. For a release-line build, confirm `latest` now resolves to the same digest.
3. **Fill the real digest into the Release** you created in Step 3
   (`gh release edit v$(cat VERSION) --notes-file <notes>`).

Report: the image reference, the digest (the only durable identifier — tags can
in principle be moved, digests cannot), whether `latest` moved, and the
`docker pull` command a deployer would run.

On failure, report which step failed and why. Do not retry blindly — a version
mismatch and a registry outage need different responses.

### Step 6 — Re-pin the deployment guides to what's published

Skip this step for a throwaway pre-release tag — it never moves `latest`, so the
guides must keep pointing at the last real release, not at it.

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

### Step 7 — Point at the upgrade path

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

Create its Release with `--latest=false`, and **skip Step 6** — it never moves
`latest` (it is not on a release line), so the guides must keep pointing at the
last real release. Say plainly that it is permanent and publicly visible — GHCR
packages can be deleted, but not cleanly, and the version history stays visible.

---

## Never

- Publish from a developer machine
- Overwrite a published tag, or re-dispatch a run for an image that already exists
- Tag or publish a build whose CI is red or unfinished
- Move `latest` to an image built from `main` or a pre-release tag
- Tag or publish a build whose `VERSION` file disagrees with the tag name, or
  whose `VERSION` and root `package.json` disagree
