# Document signatures

How approvers sign the signature slots in your templates (ADR-067, ADR-068).
Pick one install-wide method in **Settings → Signatures → PDF signatures**.

| Method | What an approver does | What the document carries | Needs |
| --- | --- | --- | --- |
| **Attestation only** (default) | Approves | The approval block: name, decision, date, verification code | Nothing |
| **Drawn signature** | Draws a signature once (remembered on their profile), then approves | Their drawing above the approval block, in the `.docx` and the PDF | A PDF converter only if a step converts to PDF |
| **Digital certificate** | Clicks **Approve & sign** and authorises at their signing provider | A PAdES B-LTA signature on a frozen PDF/A, verifiable in Acrobat or the EU DSS validator | A CSC signing provider (the PDF converter and signature engine are built in; the timestamp authority defaults to DigiCert) |

Which approvals sign is still decided by the template: an approval step signs
when it claims a `{{ … (approval) }}` slot. **Convert to PDF on signing** on an
approval step adds a PDF/A copy; it is always on under *Digital certificate*.

A drawn signature is a simple electronic signature. Only the digital
certificate method produces a signature anyone can verify outside Wayfinder.

## The engines

The default Wayfinder image converts and signs by itself (ADR-069). For each
engine, **Settings → Signatures → PDF signatures** offers **Built-in** (the
default) or **External** with a URL.

| Engine | Built in | External alternative | External URL (compose) |
| --- | --- | --- | --- |
| PDF converter | LibreOffice → PDF/A-2b | Gotenberg, compose profile `pdf` | `http://gotenberg:3000` |
| Signature engine | EU DSS on a trimmed Java runtime | Wayfinder DSS sidecar (`ghcr.io/rbrasier/wayfinder-dss`), profile `signing` | `http://dss:8080` |

Built-in engines start only when the chosen method needs them, so an
attestation-only install runs neither. The signature engine stops again after
30 minutes idle. The card shows each engine's state: *Built-in · running*,
*Built-in · idle*, or *Not included in this image*.

**Images.** `ghcr.io/rbrasier/wayfinder:<version>` includes both engines.
`…:<version>-slim` leaves them out (about 600 MB smaller); on it, choose
External or stay on attestation. The engines cannot run inside the AWS Lambda
topology, which must use External services.

**Memory.** The signature engine's Java runtime needs roughly 300–500 MB while
it runs. Give the web container that headroom when certificate signing is in
use.

| Variable | Default | Purpose |
| --- | --- | --- |
| `SIGNING_ENGINE_HEAP` | `384m` | Java heap for the built-in signature engine |
| `SIGNING_ENGINE_IDLE_MINUTES` | `30` | Stop the engine after this long unused |
| `PDF_CONVERTER_CONCURRENCY` | `2` | Conversions LibreOffice runs at once |
| `TRUST_ANCHORS_DIR` | `/app/trust` | Where the built-in engine reads trust anchors |

**Trust anchors are deployment configuration**, never an admin setting: put
the CA certificates your signers' digital IDs chain to (PEM or DER) in
`./trust`. `docker-compose.prod.yml` mounts it read-only into the web service
(`/app/trust`) for the built-in engine and into the `dss` service for the
external one. Whoever controls that list controls what counts as a valid
signature — the same split as `PKI_TRUSTED_PROXY_IPS` (ADR-042 §1).

The **timestamp authority** is an independent RFC 3161 service that vouches
for when each signature was made, which keeps signatures verifiable after the
signer's certificate expires. It is a third party by design, so it is never
built in. Leave it blank (under **Advanced**) to use DigiCert's free service,
`http://timestamp.digicert.com`; air-gapped installs set their organisation's
own. The **signing provider** is a CSC v2 remote-signing service (ETSI TS
119 432); register `https://<your Wayfinder origin>/api/signing/csc/callback`
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

For real signatures locally with the built-in engines, install LibreOffice and
point the app at a JDK and a locally built jar, trusting the mocks' CA:

```bash
cd deploy/dss && mvn -B package -DskipTests && cd ../..
export SIGNING_ENGINE_JAVA="$(command -v java)" SIGNING_ENGINE_JAR="$PWD/deploy/dss/target/wayfinder-dss.jar"
export SIGNING_TRUST_MOCK_CA=http://localhost:4001/csc/test-ca.pem DSS_ENVIRONMENT=development
pnpm dev
```

`deploy/dss/smoke-built-in.sh` runs the same checks CI runs inside the default
image. Or run the sidecar on its own against the mocks' throwaway CA:

```bash
cd deploy/dss && mvn -B package -DskipTests
SIGNING_TRUST_MOCK_CA=http://localhost:4001/csc/test-ca.pem DSS_ENVIRONMENT=development \
  PORT=8085 java -jar target/wayfinder-dss.jar
node smoke-test.mjs   # signs, extends, validates and tampers against the mocks
```

The engine refuses to trust the mock CA unless `DSS_ENVIRONMENT=development`;
both images default to `production`. See `deploy/dss/README.md`.
