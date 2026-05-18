# Publishing a Release

This project uses [Changesets](https://github.com/changesets/changesets) to
coordinate version bumps and changelog generation across all published packages.

## Packages that are published

| Package | Scope | Registry |
|---|---|---|
| `@rbrasier/domain` | Framework core | GitHub Packages |
| `@rbrasier/shared` | Zod schemas | GitHub Packages |
| `@rbrasier/application` | Use cases | GitHub Packages |
| `@rbrasier/adapters` | Concrete implementations | GitHub Packages |
| `@rbrasier/create` | Scaffold CLI | GitHub Packages |

## Step-by-step release workflow

### 1. Describe the change with a changeset

After merging a feature or fix branch, run:

```bash
pnpm changeset
```

You will be asked:
- Which packages changed (select all that are affected)
- What type of bump each deserves (`major`, `minor`, `patch`)
- A summary of the change (this becomes the changelog entry)

A `.md` file is written to `.changeset/`. Commit it:

```bash
git add .changeset/
git commit -m "chore: add changeset for <feature>"
```

### 2. Push to main

When you push to `main`, the release GitHub Action runs automatically. It
detects changeset files and opens a "Release PR" (or updates an existing one)
that contains version bumps and CHANGELOG updates.

### 3. Merge the Release PR

Review the bumped versions in the Release PR. When you're satisfied, merge it.

On merge, the Action runs `changeset publish`, which:
1. Runs `pnpm build` in each changed package
2. Publishes to GitHub Packages
3. Creates a GitHub Release tag

### Manual publish (if needed)

```bash
# Authenticate with GitHub Packages
npm login --registry=https://npm.pkg.github.com --scope=@template

# Apply pending changeset versions
pnpm changeset version

# Build all packages
pnpm build

# Publish
pnpm changeset publish
```

## Determining the bump level

Follow semver strictly:

| Scenario | Bump |
|---|---|
| Port interface added or changed, entity field removed | `major` |
| New use case, new adapter, new DB table, new entity field | `minor` |
| Bug fix, performance improvement, documentation update | `patch` |

See `docs/guides/versioning.md` for the full policy.

## Downstream projects

After a release, projects that consume these packages will be notified by
`./scripts/update-framework.sh --dry-run` (run in CI). They update by running:

```bash
./scripts/update-framework.sh
```
