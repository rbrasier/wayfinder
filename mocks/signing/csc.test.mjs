import { describe, expect, it } from "vitest";
import { createHash, createVerify, X509Certificate } from "node:crypto";
import { json, request, response } from "../test-support/http.mjs";
import { createTestAuthority } from "./test-ca.mjs";
import { createCscMock, createRevocationMock } from "./csc.mjs";

const authorityPromise = createTestAuthority("http://localhost:4001");
const mock = createCscMock(authorityPromise, "http://localhost:4001");
const REDIRECT = "http://localhost:3000/api/signing/csc/callback";

const call = async (method, url, body = null, headers = {}) => {
  const res = response();
  await mock.handle(request(method, url, body, headers), res);
  return res.recorded;
};

const api = (path, body, token) =>
  call("POST", `/csc/v2${path}`, JSON.stringify(body), {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  });

const grant = async (form) => {
  const authorized = await call("POST", "/csc/oauth2/authorize", new URLSearchParams({ redirect_uri: REDIRECT, state: "st", ...form }).toString(), {
    "Content-Type": "application/x-www-form-urlencoded",
  });
  const code = new URL(authorized.headers.Location).searchParams.get("code");
  const token = await call(
    "POST",
    "/csc/oauth2/token",
    new URLSearchParams({ grant_type: "authorization_code", code, client_id: "wayfinder", client_secret: "secret", redirect_uri: REDIRECT }).toString(),
    { "Content-Type": "application/x-www-form-urlencoded" },
  );
  return json(token).access_token;
};

describe("the mock CSC provider", () => {
  it("answers info without credentials, naming its OAuth base", async () => {
    const info = json(await api("/info", {}));

    expect(info.specs).toBe("2.0.0.2");
    expect(info.oauth2).toBe("http://localhost:4001/csc");
  });

  it("offers every scenario on the service consent page", async () => {
    const recorded = await call("GET", `/csc/oauth2/authorize?scope=service&redirect_uri=${encodeURIComponent(REDIRECT)}&state=st`);

    for (const id of ["valid", "expired", "revoked", "wrong-key-usage", "untrusted"]) {
      expect(recorded.body).toContain(`data-credential="${id}"`);
    }
  });

  it("returns the chosen credential's chain to a service token", async () => {
    const token = await grant({ scope: "service", credential: "valid" });

    const list = json(await api("/credentials/list", {}, token));
    const info = json(await api("/credentials/info", { credentialID: list.credentialIDs[0], certificates: "chain" }, token));

    expect(list.credentialIDs).toEqual(["valid"]);
    expect(new X509Certificate(Buffer.from(info.cert.certificates[0], "base64")).subject).toContain("CN=Jane Doe");
  });

  it("signs exactly the hashes the signer authorised", async () => {
    const digest = createHash("sha256").update("bytes to be signed").digest();
    const hash = digest.toString("base64");
    const token = await grant({ scope: "credential", credentialID: "valid", hashes: digest.toString("base64url") });

    const signed = json(
      await api("/signatures/signHash", { credentialID: "valid", hashes: [hash], hashAlgorithmOID: "2.16.840.1.101.3.4.2.1", signAlgo: "1.2.840.113549.1.1.11" }, token),
    );

    const authority = await authorityPromise;
    const certificate = new X509Certificate(Buffer.from(authority.signerById("valid").certificate.rawData));
    expect(
      createVerify("sha256").update("bytes to be signed").verify(certificate.publicKey, Buffer.from(signed.signatures[0], "base64")),
    ).toBe(true);
  });

  it("refuses to sign a hash the signer did not authorise", async () => {
    const authorised = createHash("sha256").update("a").digest("base64");
    const other = createHash("sha256").update("b").digest("base64");
    const token = await grant({ scope: "credential", credentialID: "valid", hashes: authorised });

    const recorded = await api("/signatures/signHash", { credentialID: "valid", hashes: [other], hashAlgorithmOID: "2.16.840.1.101.3.4.2.1" }, token);

    expect(recorded.statusCode).toBe(403);
  });

  it("refuses an unknown code at the token endpoint", async () => {
    const recorded = await call("POST", "/csc/oauth2/token", "grant_type=authorization_code&code=nope&client_id=a&client_secret=b", {
      "Content-Type": "application/x-www-form-urlencoded",
    });

    expect(recorded.statusCode).toBe(400);
  });

  it("serves the test root as PEM and the CRL as DER", async () => {
    const pem = await call("GET", "/csc/test-ca.pem");
    const revocation = createRevocationMock(authorityPromise);
    const res = response();
    await revocation.handle(request("GET", "/ocsp/root.crl"), res);

    expect(pem.body).toContain("BEGIN CERTIFICATE");
    expect(res.recorded.headers["Content-Type"]).toBe("application/pkix-crl");
  });
});
