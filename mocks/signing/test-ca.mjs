// A throwaway certificate authority for the signing mocks (ADR-067 §7),
// generated fresh each time the mocks server starts. Everything it issues is
// real X.509 with real RSA keys, so the real DSS sidecar can build and check
// PAdES signatures against it end to end.
//
// It is never trusted anywhere by default. The DSS sidecar trusts it only when
// SIGNING_TRUST_MOCK_CA points at /csc/test-ca.pem *and* DSS_ENVIRONMENT is
// "development"; a production sidecar refuses to start with the flag set.

// @peculiar/x509 resolves its algorithm providers through tsyringe, which needs
// the metadata polyfill loaded first.
import "reflect-metadata";
import { webcrypto, KeyObject, constants, privateEncrypt } from "node:crypto";
import * as x509 from "@peculiar/x509";

x509.cryptoProvider.set(webcrypto);

const RSA = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256", publicExponent: new Uint8Array([1, 0, 1]), modulusLength: 2048 };
const SIGNING_ALGORITHM = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
const DAY = 24 * 60 * 60 * 1000;

// The scenarios the certificate picker offers. Each exercises one reason the
// signing flow must refuse, plus the one that should succeed.
export const SCENARIOS = [
  { id: "valid", label: "Valid — signs successfully", name: "Jane Doe" },
  { id: "expired", label: "Expired certificate", name: "Expired Signer" },
  { id: "revoked", label: "Revoked certificate", name: "Revoked Signer" },
  { id: "wrong-key-usage", label: "Wrong key usage (encryption only)", name: "Encryption Only" },
  { id: "untrusted", label: "Untrusted issuer", name: "Untrusted Signer" },
];

const generateKeys = () => webcrypto.subtle.generateKey(RSA, true, ["sign", "verify"]);

const serialFor = (index) => (0x1000 + index).toString(16);

const signingKeyUsage = new x509.KeyUsagesExtension(
  x509.KeyUsageFlags.digitalSignature | x509.KeyUsageFlags.nonRepudiation,
  true,
);

const issue = async ({ subject, issuer, issuerKeys, keys, serialNumber, notBefore, notAfter, extensions }) =>
  x509.X509CertificateGenerator.create({
    serialNumber,
    subject,
    issuer: issuer.subject,
    notBefore,
    notAfter,
    signingAlgorithm: SIGNING_ALGORITHM,
    publicKey: keys.publicKey,
    signingKey: issuerKeys.privateKey,
    extensions: [
      ...extensions,
      await x509.AuthorityKeyIdentifierExtension.create(issuer, false),
      await x509.SubjectKeyIdentifierExtension.create(keys.publicKey),
    ],
  });

const selfSigned = async (name, keys, serialNumber) =>
  x509.X509CertificateGenerator.createSelfSigned({
    serialNumber,
    name,
    notBefore: new Date(Date.now() - DAY),
    notAfter: new Date(Date.now() + 3650 * DAY),
    signingAlgorithm: SIGNING_ALGORITHM,
    keys,
    extensions: [
      new x509.BasicConstraintsExtension(true, 1, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign, true),
      await x509.SubjectKeyIdentifierExtension.create(keys.publicKey),
    ],
  });

const scenarioCertificate = async (scenario, index, roots, crlUrl) => {
  const keys = await generateKeys();
  const issuedBy = scenario.id === "untrusted" ? roots.rogue : roots.trusted;
  const expired = scenario.id === "expired";
  const keyUsage =
    scenario.id === "wrong-key-usage"
      ? new x509.KeyUsagesExtension(x509.KeyUsageFlags.keyEncipherment, true)
      : signingKeyUsage;
  const certificate = await issue({
    subject: `CN=${scenario.name}, O=Wayfinder Mock Signers, C=AU`,
    issuer: issuedBy.certificate,
    issuerKeys: issuedBy.keys,
    keys,
    serialNumber: serialFor(index),
    notBefore: new Date(Date.now() - (expired ? 730 : 1) * DAY),
    notAfter: new Date(Date.now() + (expired ? -365 : 365) * DAY),
    extensions: [new x509.BasicConstraintsExtension(false, undefined, true), keyUsage, new x509.CRLDistributionPointsExtension([crlUrl])],
  });
  return { ...scenario, keys, certificate, chain: [certificate, issuedBy.certificate] };
};

const der = (certificate) => Buffer.from(certificate.rawData);

// Creates the whole hierarchy. `publicBaseUrl` is where the mocks server is
// reachable from the DSS sidecar, because the CRL URL is baked into each
// certificate.
export const createTestAuthority = async (publicBaseUrl) => {
  const crlUrl = `${publicBaseUrl}/ocsp/root.crl`;
  const trustedKeys = await generateKeys();
  const rogueKeys = await generateKeys();
  const roots = {
    trusted: { keys: trustedKeys, certificate: await selfSigned("CN=Wayfinder Mock Root CA, O=Wayfinder Mocks, C=AU", trustedKeys, "01") },
    rogue: { keys: rogueKeys, certificate: await selfSigned("CN=Untrusted Mock Root CA, O=Elsewhere, C=AU", rogueKeys, "02") },
  };

  const signers = [];
  for (const [index, scenario] of SCENARIOS.entries()) {
    signers.push(await scenarioCertificate(scenario, index, roots, crlUrl));
  }

  const tsaKeys = await generateKeys();
  const tsaCertificate = await issue({
    subject: "CN=Wayfinder Mock Timestamp Authority, O=Wayfinder Mocks, C=AU",
    issuer: roots.trusted.certificate,
    issuerKeys: roots.trusted.keys,
    keys: tsaKeys,
    serialNumber: "0fff",
    notBefore: new Date(Date.now() - DAY),
    notAfter: new Date(Date.now() + 3650 * DAY),
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      signingKeyUsage,
      new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.timeStamping], true),
      new x509.CRLDistributionPointsExtension([crlUrl]),
    ],
  });

  const revoked = signers.find((signer) => signer.id === "revoked");
  // Issued fresh on every fetch, like a real CA's CRL. A validator adding
  // long-term validation data for a signature needs revocation data newer than
  // its timestamp; a single CRL fixed at startup would leave every signature
  // after the first stuck below B-LT. CRL dates hold whole seconds only, so a
  // CRL issued in the same second as a timestamp would read as older than it:
  // wait for the next whole second and date the CRL then.
  const currentCrl = async () => {
    const thisUpdate = Math.ceil(Date.now() / 1000) * 1000;
    while (Date.now() < thisUpdate) {
      await new Promise((resolve) => setTimeout(resolve, thisUpdate - Date.now()));
    }
    const crl = await x509.X509CrlGenerator.create({
      issuer: roots.trusted.certificate.subject,
      thisUpdate: new Date(thisUpdate),
      nextUpdate: new Date(Date.now() + 7 * DAY),
      signingAlgorithm: SIGNING_ALGORITHM,
      signingKey: roots.trusted.keys.privateKey,
      entries: [
        { serialNumber: revoked.certificate.serialNumber, revocationDate: new Date(Date.now() - DAY), reason: x509.X509CrlReason.keyCompromise },
      ],
    });
    return Buffer.from(crl.rawData);
  };

  return {
    rootPem: roots.trusted.certificate.toString("pem"),
    rootDer: der(roots.trusted.certificate),
    currentCrl,
    signers,
    tsa: { keys: tsaKeys, certificate: tsaCertificate, rootCertificate: roots.trusted.certificate },
    signerById: (id) => signers.find((signer) => signer.id === id) ?? null,
    chainOf: (signer) => signer.chain.map((certificate) => der(certificate).toString("base64")),
  };
};

const SHA256_DIGEST_INFO_PREFIX = Buffer.from("3031300d060960864801650304020105000420", "hex");

// RSA PKCS#1 v1.5 over a precomputed SHA-256 digest — what CSC signHash does.
// WebCrypto only signs messages, so the private key is used through node:crypto.
export const signDigest = (privateKey, digest) =>
  privateEncrypt(
    { key: KeyObject.from(privateKey), padding: constants.RSA_PKCS1_PADDING },
    Buffer.concat([SHA256_DIGEST_INFO_PREFIX, digest]),
  );
