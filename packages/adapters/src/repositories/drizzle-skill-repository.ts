import {
  domainError,
  err,
  ok,
  type ISkillRepository,
  type ListSkillsInput,
  type NewSkill,
  type Result,
  type Skill,
  type SkillStatus,
  type SkillUpdate,
} from "@rbrasier/domain";
import { eq, inArray, and, desc } from "drizzle-orm";
import type { Database } from "../db/client";
import { app_skills } from "../db/schema/app";

const toEntity = (row: typeof app_skills.$inferSelect): Skill => ({
  id: row.id,
  name: row.name,
  description: row.description,
  body: row.body,
  allowedTools: row.allowed_tools,
  frontmatter: row.frontmatter,
  version: row.version,
  status: row.status,
  createdByUserId: row.created_by_user_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class DrizzleSkillRepository implements ISkillRepository {
  constructor(private readonly db: Database) {}

  async create(input: NewSkill): Promise<Result<Skill>> {
    try {
      const [row] = await this.db
        .insert(app_skills)
        .values({
          name: input.name,
          description: input.description ?? null,
          body: input.body,
          allowed_tools: input.allowedTools ?? [],
          frontmatter: input.frontmatter ?? {},
          created_by_user_id: input.createdByUserId ?? null,
        })
        .returning();
      if (!row) return err(domainError("INFRA_FAILURE", "Insert returned no row."));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to create skill.", cause));
    }
  }

  async update(id: string, patch: SkillUpdate): Promise<Result<Skill>> {
    try {
      const [current] = await this.db
        .select()
        .from(app_skills)
        .where(eq(app_skills.id, id))
        .limit(1);
      if (!current) return err(domainError("NOT_FOUND", "Skill not found."));

      const [row] = await this.db
        .update(app_skills)
        .set({
          name: patch.name ?? current.name,
          description: patch.description === undefined ? current.description : patch.description,
          body: patch.body ?? current.body,
          allowed_tools: patch.allowedTools ?? current.allowed_tools,
          frontmatter: patch.frontmatter ?? current.frontmatter,
          version: current.version + 1,
          updated_at: new Date(),
        })
        .where(eq(app_skills.id, id))
        .returning();
      if (!row) return err(domainError("INFRA_FAILURE", "Update returned no row."));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to update skill.", cause));
    }
  }

  async findById(id: string): Promise<Result<Skill | null>> {
    try {
      const [row] = await this.db
        .select()
        .from(app_skills)
        .where(eq(app_skills.id, id))
        .limit(1);
      return ok(row ? toEntity(row) : null);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to find skill.", cause));
    }
  }

  async listActiveByIds(ids: string[]): Promise<Result<Skill[]>> {
    if (ids.length === 0) return ok([]);
    try {
      const rows = await this.db
        .select()
        .from(app_skills)
        .where(and(inArray(app_skills.id, ids), eq(app_skills.status, "active")));
      return ok(rows.map(toEntity));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list skills by id.", cause));
    }
  }

  async list(input?: ListSkillsInput): Promise<Result<Skill[]>> {
    try {
      const rows = input?.includeArchived
        ? await this.db.select().from(app_skills).orderBy(desc(app_skills.updated_at))
        : await this.db
            .select()
            .from(app_skills)
            .where(eq(app_skills.status, "active"))
            .orderBy(desc(app_skills.updated_at));
      return ok(rows.map(toEntity));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list skills.", cause));
    }
  }

  async setStatus(id: string, status: SkillStatus): Promise<Result<Skill>> {
    try {
      const [row] = await this.db
        .update(app_skills)
        .set({ status, updated_at: new Date() })
        .where(eq(app_skills.id, id))
        .returning();
      if (!row) return err(domainError("NOT_FOUND", "Skill not found."));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to update skill status.", cause));
    }
  }
}
