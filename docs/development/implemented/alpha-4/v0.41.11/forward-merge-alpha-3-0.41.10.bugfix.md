# Forward merge: `release/alpha-3` 0.41.10 into `main` (v0.41.11)

## Approved change summary

Periodic forward merge of `release/alpha-3` into `main`, as described in
[`managing-releases.md`](../../../../guides/managing-releases.md) and `/release`
Operation C. Shipped as a patch bump (0.41.10 → 0.41.11) so the merge-back can be
traced like a bugfix.

## What came across

Everything on `release/alpha-3` since the previous forward merge (v0.41.4, PR #401,
which took the release line up to 0.41.3):

| Release-line change | Release PR | Release version | Trace doc on `release/alpha-3` |
|---|---|---|---|
| **Document signatures** (#386): install-wide signature method (attestation / drawn / certificate), drawn signatures remembered per user, convert-to-PDF/A on signing, CSC v2 certificate signing at PAdES B-LTA through a DSS sidecar, Signatures panel with validation badges and Re-check, signed off-system evidence, `signature.*` audit events | #390 | 0.41.2 – 0.41.4 | [`alpha-3/v0.41.2/…phase.md`](../../alpha-3/v0.41.2/document-signatures-1-config-drawn-pdf.phase.md), [`alpha-3/v0.41.3/…phase.md`](../../alpha-3/v0.41.3/document-signatures-2-certificate-signing.phase.md), [`alpha-3/v0.41.4/…phase.md`](../../alpha-3/v0.41.4/document-signatures-3-validation-and-audit.phase.md), [`…implementation-summary.md`](../../alpha-3/v0.41.4/document-signatures.implementation-summary.md); PRD `document-signatures.prd.md`; ADR-067, ADR-068 |
| **Built-in signing engines**: the default image ships its own LibreOffice converter and DSS engine on a trimmed JRE, started on demand; Built-in / External per engine; a `-slim` image leaves them out; a blank TSA means DigiCert | #390 | 0.41.5 | [`alpha-3/v0.41.5/…phase.md`](../../alpha-3/v0.41.5/built-in-signing-engines.phase.md), [`…implementation-summary.md`](../../alpha-3/v0.41.5/built-in-signing-engines.implementation-summary.md); PRD `built-in-signing-engines.prd.md`; ADR-069 |
| **Built-in engines hardening**: the converter runs with a minimal environment and refuses documents that link to outside content; supervision holes closed; `deploy/` kept out of the app image; DSS `jackson-databind` 2.22.4; mock-CA test ordering and CRL dating fixes | #390 | 0.41.6 | [`alpha-3/v0.41.6/built-in-engines-hardening.bugfix.md`](../../alpha-3/v0.41.6/built-in-engines-hardening.bugfix.md) |
| **Signed document downloads**: PDF is the primary download when a document has a current PDF, the original is a secondary "↓ DOCX"; signature CSV/JSON export removed from the panel | #390 | 0.41.7 | [`alpha-3/v0.41.7/signed-document-downloads.enhancement.md`](../../alpha-3/v0.41.7/signed-document-downloads.enhancement.md) |
| `@opentelemetry/instrumentation-http` 0.218 → 0.222 (security group) | #393 | 0.41.8 | — (Dependabot port) |
| `docker/login-action` v4.7.0 → v4.8.0 in the publish workflow | #397 | 0.41.9 | — (Dependabot) |
| `next` 15.5.28 → 15.5.29 (security group) | #399 | — | — (Dependabot port) |
| **Template drafting from examples** (#347): **Upload Template** offers "I have a template with tags" or "Use an existing example"; drafting extracts fields with the AI, places them by code, and lets a verify pass only add fields | #371 | 0.41.10 | [`alpha-3/v0.41.10/…phase.md`](../../alpha-3/v0.41.10/template-drafting-from-examples.phase.md), [`…summary.md`](../../alpha-3/v0.41.10/template-drafting-from-examples.summary.md); PRD `template-drafting-from-examples.prd.md`; ADR-070 |

The release line's trace docs, PRDs and ADRs (067–070) come across unchanged, in the
places they were written. This file is the record of the merge on `main`.

## Integrity of `main`

Since PR #401, `main` had changed only by version bumps and forward-merge records,
so the merge applied cleanly. The only conflicts were `VERSION` and root
`package.json`, which both now read 0.41.11.

This merge is much larger than the previous ones: two new features, a schema
change and a new image layout. Checked against `main`:

- **Migrations.** `0062_drawn_signature.sql` and `0063_digital_signature.sql` are
  both additive and nullable. `main` has generated no migrations of its own since
  the line was cut, so its journal is now the same as the release line's. A
  database migrated on `release/alpha-3` upgrades to `main` with nothing skipped.
  `release-line-reconciliation.ts` (which covers alpha-2) does not need a new
  entry. The next migration generated on `main` must be numbered after 0063.
  The journal's previous last entry was idx 49, so drizzle-kit will suggest
  0050 again; renumber it by hand, as the release line did for 0062.
- **ADR / PRD numbering.** `main` has no ADRs above 066 and no PRDs with these
  names, so nothing collides.
- **Doc lifecycle.** None of `main`'s `to-be-implemented/` phases cover signatures
  or template drafting, so nothing needs moving.
- **Features that landed on a release line.** Document signatures and template
  drafting were shipped on `release/alpha-3` as PATCH bumps, by maintainer
  decision. On `main` they are simply part of the alpha-4 baseline. The signatures
  summary asked that "`main` must bump above 0.41.4 on the next forward-merge",
  and 0.41.11 does that.
- **Image.** The default `Dockerfile` target now includes the built-in engines,
  and `runtime-slim` leaves them out. CI's `docker-image` job and the DSS
  mock-CA job come across with it.

## Deliberately not taken

Nothing. Every commit applies to `main` as it is.

## Version

0.41.4 → **0.41.11** (patch, as asked for a merge-back). This moves past the
release line's 0.41.10 so `main` never sorts below the line it absorbs.
`VERSION` and `package.json` match.

`release/alpha-3`'s next patch will also be 0.41.11. The docs folder (`alpha-3/`
vs `alpha-4/`) and the branch tell the two apart, as with earlier forward merges.
