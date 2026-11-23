import type { DrawnSignature } from "../entities/drawn-signature";
import type { Result } from "../result";

// The pointer to each user's remembered drawing (ADR-067 §2). The image itself
// lives in object storage; this records which object is current.
export interface IDrawnSignatureRepository {
  findByUserId(userId: string): Promise<Result<DrawnSignature | null>>;
  save(signature: DrawnSignature): Promise<Result<void>>;
}
