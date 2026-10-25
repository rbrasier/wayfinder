import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const BEARER_PATTERN = /^Bearer (.+)$/i;

// Hashing both sides first gives timingSafeEqual equal-length inputs, so the
// comparison leaks neither the key's contents nor its length.
const keysMatch = (presented: string, expected: string): boolean => {
  const presentedDigest = createHash("sha256").update(presented, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(presentedDigest, expectedDigest);
};

const refuse = (response: Response, message: string): void => {
  response.status(401).json({ error: { code: "UNAUTHORIZED", message } });
};

// Service-to-service authentication for the API's management routes (ADR-067).
// An unset key refuses everything, so an unconfigured install fails closed.
export const requireServiceKey =
  (expectedKey: string | undefined) =>
  (request: Request, response: Response, next: NextFunction): void => {
    if (!expectedKey) {
      refuse(response, "API_SERVICE_KEY is not configured.");
      return;
    }

    const presentedKey = BEARER_PATTERN.exec(request.headers.authorization ?? "")?.[1];
    if (!presentedKey || !keysMatch(presentedKey, expectedKey)) {
      refuse(response, "Missing or invalid service key.");
      return;
    }

    next();
  };
