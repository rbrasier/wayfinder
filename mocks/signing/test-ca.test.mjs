import { describe, expect, it } from "vitest";
import { createHash, createVerify, X509Certificate } from "node:crypto";
import { createTestAuthority, signDigest } from "./test-ca.mjs";

const authority = await createTestAuthority("http://localhost:4001");

describe("the mock test CA", () => {
  it("issues every scenario from the trusted root except the untrusted one", () => {
    const root = new X509Certificate(authority.rootDer);
    for (const signer of authority.signers) {
      const certificate = new X509Certificate(Buffer.from(signer.certificate.rawData));
      expect(certificate.verify(root.publicKey)).toBe(signer.id !== "untrusted");
    }
  });

  it("issues an expired certificate for the expired scenario", () => {
    const certificate = new X509Certificate(Buffer.from(authority.signerById("expired").certificate.rawData));

    expect(new Date(certificate.validTo).getTime()).toBeLessThan(Date.now());
  });

  it("lists the revoked signer on a CRL issued at the time of asking", async () => {
    const revoked = authority.signerById("revoked").certificate.serialNumber;

    const crl = await authority.currentCrl();

    expect(crl.includes(Buffer.from(revoked, "hex"))).toBe(true);
  });

  it("produces a PKCS#1 signature over a digest that verifies as SHA-256 with RSA", () => {
    const signer = authority.signerById("valid");
    const message = Buffer.from("the bytes to be signed");
    const digest = createHash("sha256").update(message).digest();

    const signature = signDigest(signer.keys.privateKey, digest);

    const certificate = new X509Certificate(Buffer.from(signer.certificate.rawData));
    expect(createVerify("sha256").update(message).verify(certificate.publicKey, signature)).toBe(true);
  });

  it("exports the chain signer-first, as the signing provider returns it", () => {
    const chain = authority.chainOf(authority.signerById("valid"));

    expect(chain).toHaveLength(2);
    expect(new X509Certificate(Buffer.from(chain[1], "base64")).subject).toContain("Wayfinder Mock Root CA");
  });
});
