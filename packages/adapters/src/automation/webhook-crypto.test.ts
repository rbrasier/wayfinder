import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { nodeWebhookCrypto, verifyHmacSignature } from "./webhook-crypto";

describe("nodeWebhookCrypto", () => {
  it("generates long, URL-safe, distinct secrets", () => {
    const first = nodeWebhookCrypto.generateSecret();
    const second = nodeWebhookCrypto.generateSecret();

    expect(first).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(first).not.toBe(second);
  });

  it("hashes a token to stable SHA-256 hex", () => {
    expect(nodeWebhookCrypto.hashToken("wf_wh_abc")).toBe(nodeWebhookCrypto.hashToken("wf_wh_abc"));
    expect(nodeWebhookCrypto.hashToken("wf_wh_abc")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("matches equal hashes and rejects different or differently sized ones", () => {
    const hash = nodeWebhookCrypto.hashToken("a");

    expect(nodeWebhookCrypto.hashesMatch(hash, hash)).toBe(true);
    expect(nodeWebhookCrypto.hashesMatch(hash, nodeWebhookCrypto.hashToken("b"))).toBe(false);
    expect(nodeWebhookCrypto.hashesMatch(hash, "short")).toBe(false);
  });
});

describe("verifyHmacSignature", () => {
  const body = '{"inputs":{"hearing_id":"H-1"}}';
  const signature = `sha256=${createHmac("sha256", "s3cret").update(body).digest("hex")}`;

  it("accepts the sha256= HMAC of the exact body", () => {
    expect(verifyHmacSignature("s3cret", body, signature)).toBe(true);
  });

  it("rejects a signature made with another secret or over another body", () => {
    expect(verifyHmacSignature("other", body, signature)).toBe(false);
    expect(verifyHmacSignature("s3cret", `${body} `, signature)).toBe(false);
    expect(verifyHmacSignature("s3cret", body, "sha256=00")).toBe(false);
  });
});
