# Versioning & Doc Lifecycle

## Version sources of truth

Two places, must always match:

- `VERSION` (plain text, single line)
- root `package.json` → `version`

`validate.sh` fails if they differ.

## Bump rules

| Bump  | When…                                                   |
| ----- | ------------------------------------------------------- |
| MAJOR | Breaking API or domain changes                          |
| MINOR | DB schema change, new phase implementation, new feature |
| PATCH | Bug fixes, UI tweaks, config changes (no schema impact) |

Starting version: `0.1.0`.

## Doc lifecycle

```
docs/development/
├── prd/                  Permanent home for PRDs (one per major feature/area)
├── adr/                  Permanent home for ADRs (one per architectural decision)
├── to-be-implemented/    Phase docs awaiting implementation (planning/review)
└── implemented/
    ├── v0.1/             Each version has its own folder
    │   └── *.md          Phase doc + implementation summary
    ├── v0.2/
    └── ...
```

### Phase doc lifecycle (per feature)

1. **Plan**: New App / Feature Setup skill produces a phase doc in
   `to-be-implemented/`, plus a PRD and ADR(s) if relevant.
2. **Review**: Documentation Review skill checks consistency. Output is
   PASS / WARN / FAIL — code does not start until PASS.
3. **Build**: Build skill implements the spec, moves the phase doc to
   `implemented/v<version>/`, writes a same-folder implementation summary,
   updates `VERSION` and `package.json`.
4. **Validate**: `./validate.sh` runs. The doc lifecycle check fails if any
   file in `to-be-implemented/` is referenced by an implementation summary
   in `implemented/` (it should have been moved).

### Implementation summary template

```markdown
# Implementation Summary — <feature name>

**Version**: 0.x.0  (bump: MINOR/PATCH/MAJOR)
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
