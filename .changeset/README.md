# Changesets

This directory is managed by [Changesets](https://github.com/changesets/changesets),
which coordinates per-package version bumps and changelog entries inside the
monorepo. `pnpm changeset` writes a `.md` file here describing a change;
`pnpm changeset version` consumes those files to bump the affected
`packages/*` versions and write CHANGELOG entries.

Note: this tooling versions the internal workspace packages only. It is not
part of releasing the Wayfinder application — alpha releases are cut from
branches as described in
[`docs/guides/managing-releases.md`](../docs/guides/managing-releases.md),
and the application version lives in `VERSION` / root `package.json`.
