import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import {
  domainError,
  err,
  ok,
  type ISessionParticipantRepository,
  type NewSessionParticipant,
  type Result,
  type SessionParticipant,
  type SessionParticipantRole,
} from "@rbrasier/domain";
import type { Database } from "../db/client";
import { app_session_participants } from "../db/schema/wayfinder";

// Idempotent join: insert the membership, or do nothing if one already exists so
// a repeated collaborate-link open never crashes on the unique constraint and
// never re-upgrades a downgraded (revoked) role. Returns the freshly inserted
// row; on a no-op the caller re-reads the existing one.
export const buildEnrolParticipantStatement = (input: NewSessionParticipant): SQL => sql`
  INSERT INTO ${app_session_participants}
    (${sql.identifier("session_id")}, ${sql.identifier("user_id")},
     ${sql.identifier("role")}, ${sql.identifier("invited_by")})
  VALUES (${input.sessionId}, ${input.userId}, ${input.role}, ${input.invitedBy ?? null})
  ON CONFLICT (${sql.identifier("session_id")}, ${sql.identifier("user_id")}) DO NOTHING
  RETURNING *
`;

const toEntity = (row: typeof app_session_participants.$inferSelect): SessionParticipant => ({
  id: row.id,
  sessionId: row.session_id,
  userId: row.user_id,
  role: row.role,
  joinedAt: row.joined_at,
  invitedBy: row.invited_by ?? null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class DrizzleSessionParticipantRepository implements ISessionParticipantRepository {
  constructor(private readonly db: Database) {}

  async listBySession(sessionId: string): Promise<Result<SessionParticipant[]>> {
    try {
      const rows = await this.db
        .select()
        .from(app_session_participants)
        .where(eq(app_session_participants.session_id, sessionId))
        .orderBy(asc(app_session_participants.joined_at));
      return ok(rows.map(toEntity));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list session participants.", cause));
    }
  }

  async findBySessionAndUser(
    sessionId: string,
    userId: string,
  ): Promise<Result<SessionParticipant | null>> {
    try {
      const [row] = await this.db
        .select()
        .from(app_session_participants)
        .where(
          and(
            eq(app_session_participants.session_id, sessionId),
            eq(app_session_participants.user_id, userId),
          ),
        );
      return ok(row ? toEntity(row) : null);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to find session participant.", cause));
    }
  }

  async enrol(input: NewSessionParticipant): Promise<Result<SessionParticipant>> {
    try {
      const rows = (await this.db.execute(
        buildEnrolParticipantStatement(input),
      )) as unknown as (typeof app_session_participants.$inferSelect)[];
      const inserted = rows[0];
      if (inserted) return ok(toEntity(inserted));

      // Row already existed (ON CONFLICT DO NOTHING returned nothing): hand back
      // the current membership unchanged rather than a spurious failure.
      const existing = await this.findBySessionAndUser(input.sessionId, input.userId);
      if (existing.error) return existing;
      if (!existing.data) {
        return err(domainError("INFRA_FAILURE", "Enrol returned no row and none exists."));
      }
      return ok(existing.data);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to enrol session participant.", cause));
    }
  }

  async setRole(
    sessionId: string,
    userId: string,
    role: SessionParticipantRole,
  ): Promise<Result<SessionParticipant>> {
    try {
      const [row] = await this.db
        .update(app_session_participants)
        .set({ role, updated_at: new Date() })
        .where(
          and(
            eq(app_session_participants.session_id, sessionId),
            eq(app_session_participants.user_id, userId),
          ),
        )
        .returning();
      if (!row) return err(domainError("NOT_FOUND", "Session participant not found."));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to update participant role.", cause));
    }
  }

  async remove(sessionId: string, userId: string): Promise<Result<void>> {
    try {
      await this.db
        .delete(app_session_participants)
        .where(
          and(
            eq(app_session_participants.session_id, sessionId),
            eq(app_session_participants.user_id, userId),
          ),
        );
      return ok(undefined);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to remove session participant.", cause));
    }
  }
}
