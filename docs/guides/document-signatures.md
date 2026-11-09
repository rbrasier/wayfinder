# Document signatures

How approvers sign the signature slots in your templates (ADR-067, ADR-068).
Pick one install-wide method in **Settings → Signatures → PDF signatures**.

| Method | What an approver does | What the document carries | Needs |
| --- | --- | --- | --- |
| **Attestation only** (default) | Approves | The approval block: name, decision, date, verification code | Nothing |
| **Drawn signature** | Draws a signature once (remembered on their profile), then approves | Their drawing above the approval block, in the `.docx` and the PDF | A PDF converter only if a step converts to PDF |
| **Digital certificate** | Clicks **Approve & sign** and authorises at their signing provider | A PAdES B-LTA signature on a frozen PDF/A, verifiable in Acrobat or the EU DSS validator | PDF converter, signature engine, timestamp authority, CSC signing provider |

Which approvals sign is still decided by the template: an approval step signs
when it claims a `{{ … (approval) }}` slot. **Convert to PDF on signing** on an
approval step adds a PDF/A copy; it is always on under *Digital certificate*.

A drawn signature is a simple electronic signature. Only the digital
certificate method produces a signature anyone can verify outside Wayfinder.

## The services

Both run as opt-in compose profiles; installs that never sign with
certificates run neither.

| Service | Profile | Settings field | Production URL |
| --- | --- | --- | --- |
| Gotenberg (LibreOffice → PDF/A-2b) | `pdf` | PDF converter URL | `http://gotenberg:3000` |
| Wayfinder DSS sidecar (`ghcr.io/rbrasier/wayfinder-dss`) | `signing` | Signature engine URL | `http://dss:8080` |

```bash
docker compose -f docker-compose.prod.yml --profile pdf --profile signing up -d
```

**Trust anchors are deployment configuration**, never an admin setting: put
the CA certificates your signers' digital IDs chain to (PEM or DER) in
`./trust`, which the `dss` service mounts read-only. Whoever controls that list
controls what counts as a valid signature — the same split as
`PKI_TRUSTED_PROXY_IPS` (ADR-042 §1).

The **timestamp authority** is any RFC 3161 service your organisation or
provider offers. The **signing provider** is a CSC v2 remote-signing service
(ETSI TS 119 432); register `https://<your Wayfinder origin>/api/signing/csc/callback`
as its redirect URI and enter its base URL, client ID and secret.

Saving the *Digital certificate* method runs a live Test of all four services
first and refuses if any fails. Signing fails closed: if a service is down
when an approver signs, the approval stays pending with the reason shown.

## What changes for approvers and authors

- The first certificate signature **freezes** the document as a PDF/A. After
  that it cannot be regenerated or edited; later signatures are added to the
  same PDF. A change request or rejection supersedes the frozen PDF and
  signing starts again on the reworked document.
- Each signed document shows a **Signatures** panel: signer, certificate,
  time, timestamp, level and a badge — valid, valid-but-expired,
  invalid-modified or unverifiable — with **Re-check** and CSV/JSON export.
- An approval recorded **off system** on a certificate step must upload the PDF
  the approver digitally signed; it is validated, and its signer must be the
  nominated approver.
- Nobody can sign while an admin is viewing as them.

## Development and testing

The shared mocks server (`mocks/`, port 4001) stands in for every service:

| Path | Stands in for |
| --- | --- |
| `/gotenberg` | Gotenberg (returns a fixed PDF) |
| `/csc/v2` | CSC signing provider; its consent page is a picker of test digital IDs — valid, expired, revoked, wrong key usage, untrusted |
| `/tsa` | RFC 3161 timestamp authority (real tokens) |
| `/ocsp/root.crl` | The test CA's revocation list |
| `/dss` | The DSS sidecar (canned; used by the e2e suite) |

For real signatures locally, run the sidecar against the mocks' throwaway CA:

```bash
cd deploy/dss && mvn -B package -DskipTests
SIGNING_TRUST_MOCK_CA=http://localhost:4001/csc/test-ca.pem DSS_ENVIRONMENT=development \
  PORT=8085 java -jar target/wayfinder-dss.jar
node smoke-test.mjs   # signs, extends, validates and tampers against the mocks
```

The sidecar refuses to trust the mock CA unless `DSS_ENVIRONMENT=development`;
its image defaults to `production`. See `deploy/dss/README.md`.
