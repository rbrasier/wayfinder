# Changesets

This directory is managed by [Changesets](https://github.com/changesets/changesets).

## How to cut a release

1. After merging one or more features, run:
   ```bash
   pnpm changeset
   ```
   This prompts you to describe what changed (which packages, which bump level, summary).
   A `.md` file is written to this directory.

2. When ready to publish, run:
   ```bash
   pnpm changeset version   # bumps versions in package.json + writes CHANGELOG entries
   pnpm changeset publish   # builds and publishes to the configured registry
   ```

Or push to `main` — the release GitHub Action runs `changeset publish` automatically
when changeset files are present.

See `docs/guides/publishing-a-release.md` for the full workflow.
