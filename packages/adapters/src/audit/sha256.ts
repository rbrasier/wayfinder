import { createHash } from "node:crypto";
import type { Sha256Bytes, Sha256Hex } from "@wayfinder/domain";

// The SHA-256 primitive the domain hash-chain functions require. Lives in the
// adapter layer because the domain forbids non-relative imports (node:crypto
// included).
export const sha256Hex: Sha256Hex = (input) =>
  createHash("sha256").update(input, "utf8").digest("hex");

// Byte-oriented variant, used to fingerprint flow-archive assets.
export const sha256Bytes: Sha256Bytes = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
