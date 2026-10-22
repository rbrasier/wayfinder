import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const constantTimeEqual = (left: string, right: string): boolean => {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  if (leftBytes.length !== rightBytes.length) return false;
  return timingSafeEqual(leftBytes, rightBytes);
};

// `X-…-Signature: sha256=<hex>` over the raw request body — the scheme the n8n
// callback already uses, shared by the flow webhook (ADR-064 §3).
export const verifyHmacSignature = (secret: string, rawBody: string | Buffer, signature: string): boolean => {
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  return constantTimeEqual(expected, signature);
};

// Satisfies the application's WebhookCrypto and WebhookVerification.
export const nodeWebhookCrypto = {
  // 32 random bytes — 256 bits — as URL-safe base64.
  generateSecret: (): string => randomBytes(32).toString("base64url"),
  hashToken: (token: string): string => createHash("sha256").update(token).digest("hex"),
  hashesMatch: constantTimeEqual,
  verifySignature: (secret: string, rawBody: string, signature: string): boolean =>
    verifyHmacSignature(secret, rawBody, signature),
};
