import { describe, expect, it } from "vitest";
import { SettingsEncryptionService } from "../config/settings-encryption";
import { decodeMcpServerSecrets, encodeMcpServerSecretsPatch } from "./drizzle-mcp-server-secret-store";

const encryption = new SettingsEncryptionService(Buffer.alloc(32, 3));

describe("encodeMcpServerSecretsPatch", () => {
  it("encrypts the token and headers into enc:v1 envelopes", () => {
    const columns = encodeMcpServerSecretsPatch({ bearerToken: "token-1", headers: { "X-Key": "v" } }, encryption);

    expect(columns.credential_ciphertext?.startsWith("enc:v1:")).toBe(true);
    expect(columns.custom_headers_ciphertext?.startsWith("enc:v1:")).toBe(true);
    expect(JSON.stringify(columns)).not.toContain("token-1");
  });

  it("leaves an omitted secret out of the update and writes null to clear one", () => {
    expect(encodeMcpServerSecretsPatch({ bearerToken: null }, encryption)).toEqual({ credential_ciphertext: null });
    expect(encodeMcpServerSecretsPatch({ headers: {} }, encryption)).toEqual({ custom_headers_ciphertext: null });
    expect(encodeMcpServerSecretsPatch({}, encryption)).toEqual({});
  });
});

describe("decodeMcpServerSecrets", () => {
  it("round-trips what was encoded", () => {
    const columns = encodeMcpServerSecretsPatch({ bearerToken: "token-1", headers: { "X-Key": "v" } }, encryption);

    expect(
      decodeMcpServerSecrets(
        { credential_ciphertext: columns.credential_ciphertext ?? null, custom_headers_ciphertext: columns.custom_headers_ciphertext ?? null },
        encryption,
      ),
    ).toEqual({ bearerToken: "token-1", headers: { "X-Key": "v" } });
  });

  it("reads absent columns as no secrets", () => {
    expect(
      decodeMcpServerSecrets({ credential_ciphertext: null, custom_headers_ciphertext: null }, encryption),
    ).toEqual({ bearerToken: null, headers: {} });
  });
});
