# Wayfinder signature engine (DSS sidecar)

A thin JSON-over-HTTP wrapper around the EU Commission's
[DSS](https://github.com/esig/dss) library, used only when an install signs
with **digital certificates** (ADR-067 §4). It never holds a private key and
never sees signing credentials: Wayfinder's CSC adapter has the signer's
provider sign a hash, and this service builds and validates the PAdES around it.

| Endpoint | Does |
| --- | --- |
| `GET /health` | `{"status":"up","trustAnchors":n}` |
| `POST /prepare` | Checks the signing certificate (validity, revocation, trust, key usage) and returns the SHA-256 of the bytes to be signed |
| `POST /sign` | Incorporates the signature value as a PAdES B-LTA revision (RFC 3161 timestamp from the request's `tsaUrl`, CRL/OCSP embedded) |
| `POST /validate` | ETSI indication and sub-indication for every signature in a PDF |

## Trust anchors

Mount PEM or DER certificates into `/trust` (`TRUST_ANCHORS_DIR`). This is
deployment configuration, not an admin setting, for the same reason as
`PKI_TRUSTED_PROXY_IPS` (ADR-042 §1): whoever controls the trust list controls
what counts as a valid signature.

## Development

The shared mocks server publishes a throwaway test CA. To trust it:

```bash
SIGNING_TRUST_MOCK_CA=http://localhost:4001/csc/test-ca.pem \
DSS_ENVIRONMENT=development PORT=8085 \
java -jar target/wayfinder-dss.jar
```

The sidecar refuses to start with `SIGNING_TRUST_MOCK_CA` set unless
`DSS_ENVIRONMENT=development`; the image defaults to `production`.

Build locally with `mvn -B package` (Java 21), or `docker build -t wayfinder-dss .`.

`smoke-test.mjs` signs a PDF twice against the mocks and this sidecar and
checks both signatures validate at B-LTA and that tampering is detected — the
real-crypto check CI runs (`.github/workflows/ci.yml`, `dss-integration`).
