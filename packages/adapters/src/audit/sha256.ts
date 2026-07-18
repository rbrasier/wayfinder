import { createHash } from "node:crypto";
import type { Sha256Hex } from "@rbrasier/domain";

// The SHA-256 primitive the domain hash-chain functions require. Lives in the
// adapter layer because the domain forbids non-relative imports (node:crypto
// included).
export const sha256Hex: Sha256Hex = (input) =>
  createHash("sha256").update(input, "utf8").digest("hex");
