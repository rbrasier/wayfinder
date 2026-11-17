import {
  domainError,
  err,
  ok,
  type DrawnSignature,
  type IDrawnSignatureRepository,
  type Result,
} from "@wayfinder/domain";
import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { core_users } from "../db/schema/core";

interface DrawnSignatureColumns {
  drawn_signature_storage_path: string | null;
  drawn_signature_updated_at: Date | null;
}

export const drawnSignatureFromColumns = (
  userId: string,
  columns: DrawnSignatureColumns,
): DrawnSignature | null => {
  if (!columns.drawn_signature_storage_path || !columns.drawn_signature_updated_at) return null;
  return {
    userId,
    storagePath: columns.drawn_signature_storage_path,
    updatedAt: columns.drawn_signature_updated_at,
  };
};

// The pointer lives on core_users because a user has exactly one current
// drawing; the image itself is in object storage (ADR-067 §2).
export class DrizzleDrawnSignatureRepository implements IDrawnSignatureRepository {
  constructor(private readonly db: Database) {}

  async findByUserId(userId: string): Promise<Result<DrawnSignature | null>> {
    try {
      const [row] = await this.db
        .select({
          drawn_signature_storage_path: core_users.drawn_signature_storage_path,
          drawn_signature_updated_at: core_users.drawn_signature_updated_at,
        })
        .from(core_users)
        .where(eq(core_users.id, userId));
      return ok(row ? drawnSignatureFromColumns(userId, row) : null);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to read the drawn signature.", cause));
    }
  }

  async save(signature: DrawnSignature): Promise<Result<void>> {
    try {
      await this.db
        .update(core_users)
        .set({
          drawn_signature_storage_path: signature.storagePath,
          drawn_signature_updated_at: signature.updatedAt,
          updated_at: new Date(),
        })
        .where(eq(core_users.id, signature.userId));
      return ok(undefined);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to save the drawn signature.", cause));
    }
  }
}
