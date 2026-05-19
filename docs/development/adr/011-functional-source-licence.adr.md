# ADR-011 — Functional Source Licence for Wayfinder

- **Status**: Accepted
- **Date**: 2026-05-19

## Context

Wayfinder is open source but the primary target is enterprise and government
self-hosting. Licence choice shapes who can fork it, who can monetise it, and
how broadly it can be adopted.

The candidate licences:

| Licence            | Allows commercial fork? | Allows competing SaaS? | Notes |
| ------------------ | ----------------------- | ---------------------- | ----- |
| MIT / Apache 2.0   | Yes                     | Yes                    | Maximum permissiveness; well-understood; no SaaS protection |
| AGPL 3.0           | Yes (with source share) | Yes (with source share)| Network-use copyleft; some enterprises legally reject AGPL |
| BUSL 1.1           | Restricted              | No (until exit)        | Reverts to permissive after a fixed period; less standard |
| Functional Source Licence (FSL) | Restricted | No (for 2 years)       | Same model as n8n; converts to Apache 2.0 after 2 years |
| Proprietary        | No                      | No                     | Not open source |

n8n itself (which Wayfinder will integrate with) ships under FSL. Adopting
the same licence signals that Wayfinder is built in the same spirit.

## Decision

Adopt the **Functional Source Licence (FSL)**, version 1.1, future change
licence **Apache 2.0**, change date **2 years** from each release.

### Key terms (summary, not legal text)

- Free to use, modify, and self-host for any purpose **except** offering a
  commercial hosted Wayfinder service that competes with the upstream project.
- Conversion: every released version automatically converts to Apache 2.0 two
  years after its release date.
- Modifications must carry a notice indicating they were modified.

### What ships in the repo

- `LICENSE` — full FSL 1.1 text at the repo root.
- `README.md` — short licence summary plus links to the FSL FAQ.
- `CONTRIBUTING.md` — Contributor Licence Agreement note: contributions are
  taken under the same FSL terms (so the project can re-license under
  Apache 2.0 at the change date without contributor surprises).

### What this excludes

The licence does **not** restrict:

- Internal use within an agency or company.
- Embedding Wayfinder into another (non-competing) product.
- Building paid implementation / consulting services on top of self-hosted
  Wayfinder.

## Consequences

**Positive**

- Self-hosting agencies and enterprises can use Wayfinder freely.
- A competing SaaS clone is not a viable commercial fork during the change
  window — protects future hosted-Wayfinder plans without blocking community
  use.
- The 2-year conversion to Apache 2.0 reassures the long-term-stewardship
  community that the licence is time-bounded.

**Negative**

- FSL is not an OSI-approved licence. Some procurement / legal teams reject
  non-OSI licences on policy. Documented in the README so the constraint is
  visible up front.
- The Apache 2.0 change date is per-version, so each release has its own
  countdown. CI publishes the conversion date in release notes to avoid
  confusion.

## Alternatives considered

- **MIT** — rejected: no protection against a hosted SaaS clone.
- **AGPL 3.0** — rejected: enterprise blocklist risk.
- **BUSL 1.1** — close fit but less established in the AI ecosystem. FSL
  preferred because of alignment with n8n.

## Implementation note

The licence file is added as part of Phase 4 (Open Source Prep). It is not
in any earlier phase to avoid premature commitment while the PRD is still
being shaped. Earlier phases ship the repo as "All rights reserved" by
default — internal-use-only — and the Phase 4 PR adds `LICENSE`.
