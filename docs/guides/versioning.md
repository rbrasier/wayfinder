# Versioning & Doc Lifecycle

## Version sources of truth

Two places, must always match:

- `VERSION` (plain text, single line)
- root `package.json` → `version`

`validate.sh` fails if they differ.

## Bump rules

Wayfinder is pre-release software, so it follows semver's pre-1.0 rule:
**MAJOR stays `0` until the first stable release**. Every version is
`0.MINOR.PATCH`.

| Bump  | When…                                                   |
| ----- | ------------------------------------------------------- |
| MAJOR | Reserved. `0` → `1.0.0` happens exactly once, at the first stable release. After that it carries its normal semver meaning (breaking changes) |
| MINOR | DB schema change, new phase implementation, new feature |
| PATCH | Bug fixes, UI tweaks, config changes (no schema impact) |

### The stage is not in the version number

Which pre-release line a build belongs to — alpha-2, alpha-3, beta-1 — is
recorded in the **branch name** (`release/alpha-3`) and the **docs folder**
(`implemented/alpha-2/`), never in the version digits. Cutting a new line
creates a branch; it does not bump anything on its own.

This keeps MINOR and PATCH free to mean what they say. MINOR counts up
continuously across lines, so versions never restart, never go backwards, and
sort correctly forever. A version alone tells you *what changed*; the branch or
docs folder tells you *which line shipped it*.

The first stable release is `1.0.0`, cut from the last beta line. See
[`managing-releases.md`](./managing-releases.md) for the branch model and the
maintainer runbook.

## Doc lifecycle

```
docs/development/
├── prd/                  Permanent home for PRDs (one per major feature/area)
├── adr/                  Permanent home for ADRs (one per architectural decision)
├── to-be-implemented/    Phase docs awaiting implementation (planning/review)
└── implemented/
    ├── alpha-1/          One folder per release line
    │   ├── v0.1/         Each version has its own folder inside its release line
    │   │   └── *.md      Phase doc + implementation summary
    │   ├── v1.0.0/
    │   └── ...
    ├── alpha-2/
    │   ├── v2.1.0/
    │   └── ...
    ├── alpha-3/
    │   └── ...
    └── alpha-4/
        └── ...
```

Every implemented phase doc lives under its release line:
`implemented/<release line>/v<version>/`. Nothing is ever written into
`implemented/` directly.

**The release line comes from the branch you are working on, not from the
version number.** Skills read both from the **Release Branching** section of
[`CLAUDE.md`](../../CLAUDE.md):

| Base branch | Release line folder |
|---|---|
| `main` | the `Next release line` value — currently `alpha-4` |
| the current release branch | its own name — currently `alpha-3` |

### Version history

Version numbers were restructured when the alpha-3 line opened. Before that,
each alpha owned a MAJOR line (alpha-1 = `1.x.x`, alpha-2 = `2.x.x`), which put
the project on `2.x` while it was still alpha — the opposite of what semver's
MAJOR digit means.

Historical folders keep the version they actually shipped under; they are a
record, not a naming convention to extend:

| Release line | Versions as shipped | Notes |
|---|---|---|
| alpha-1 | `v0.1` → `v1.59.2` | Started pre-`1.0`, then moved to the `1.x` line mid-flight. Retired |
| alpha-2 | `v2.0.2` → `v2.19.1`, then `v0.19.1` → `v0.28.50` | The `2.x` line, renumbered to `0.19.1` at the cutover; later fixes on this branch were `0.19.x`–`0.28.x`. Retired when alpha-3 was cut; archived as `archive/release/alpha-2` |
| alpha-3 | `v0.29.0` → `v0.41.0` at the cut | Developed on `main`, cut to `release/alpha-3` at `0.41.0`; fixes on it are `0.41.x` |
| alpha-4 onwards | `v0.42.0` → | Continuous `0.MINOR.PATCH`; MINOR continues alpha-3's count |

Nothing was ever tagged or published under the old numbers, so no external
reference breaks. Cross-references inside historical docs may point at paths
that predate the release-line folders — read them as version identifiers, not
as live links.

### Phase doc lifecycle (per feature)

1. **Plan**: New App / Feature Setup skill produces a phase doc in
   `to-be-implemented/`, plus a PRD and ADR(s) if relevant.
2. **Review**: Documentation Review skill checks consistency. Output is
   PASS / WARN / FAIL — code does not start until PASS.
3. **Build**: Build skill implements the spec, moves the phase doc to
   `implemented/<release line>/v<version>/`, writes a same-folder implementation
   summary, updates `VERSION` and `package.json`.
4. **Validate**: `./validate.sh` runs. The doc lifecycle check fails if any
   file in `to-be-implemented/` is referenced by an implementation summary
   in `implemented/` (it should have been moved).

### Implementation summary template

```markdown
# Implementation Summary — <feature name>

**Version**: 0.x.0  (bump: MINOR/PATCH)
**Phase doc**: <link to moved phase doc>
**PRD**:       <link>
**ADR(s)**:    <links>

## What was built
- bullet list of capabilities delivered

## Files created
- packages/.../foo.ts
- apps/.../bar.tsx

## Files modified
- ...

## Migrations run
- 0001_add_app_foo.sql

## Known limitations
- bullet list

## Validation
- ./validate.sh: PASS (date)
```

## Why both `VERSION` and `package.json`?

- `VERSION` is for humans and CI scripts that don't parse JSON.
- `package.json#version` is what npm tooling and Turbo cache invalidation read.

`validate.sh` keeps them in lockstep.
