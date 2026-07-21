import {
  domainError,
  err,
  ok,
  type IOrganisationRepository,
  type NewOrganisation,
  type Organisation,
  type OrganisationUpdate,
  type Result,
} from "@rbrasier/domain";
import { count, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { core_organisations, core_users } from "../db/schema/core";

const toEntity = (row: typeof core_organisations.$inferSelect): Organisation => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  emailDomain: row.email_domain ?? null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class DrizzleOrganisationRepository implements IOrganisationRepository {
  constructor(private readonly db: Database) {}

  async list(): Promise<Result<Organisation[]>> {
    try {
      const rows = await this.db.select().from(core_organisations).orderBy(core_organisations.name);
      return ok(rows.map(toEntity));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list organisations.", cause));
    }
  }

  async findById(id: string): Promise<Result<Organisation | null>> {
    try {
      const [row] = await this.db
        .select()
        .from(core_organisations)
        .where(eq(core_organisations.id, id))
        .limit(1);
      return ok(row ? toEntity(row) : null);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to find organisation.", cause));
    }
  }

  async findBySlug(slug: string): Promise<Result<Organisation | null>> {
    try {
      const [row] = await this.db
        .select()
        .from(core_organisations)
        .where(eq(core_organisations.slug, slug))
        .limit(1);
      return ok(row ? toEntity(row) : null);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to find organisation.", cause));
    }
  }

  async create(organisation: NewOrganisation): Promise<Result<Organisation>> {
    try {
      const [row] = await this.db
        .insert(core_organisations)
        .values({
          name: organisation.name,
          slug: organisation.slug,
          email_domain: organisation.emailDomain ?? null,
        })
        .returning();
      if (!row) return err(domainError("INFRA_FAILURE", "Organisation insert returned no row."));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to create organisation.", cause));
    }
  }

  async update(id: string, patch: OrganisationUpdate): Promise<Result<Organisation>> {
    try {
      const values: {
        name?: string;
        slug?: string;
        email_domain?: string | null;
        updated_at: Date;
      } = { updated_at: new Date() };
      if (patch.name !== undefined) values.name = patch.name;
      if (patch.slug !== undefined) values.slug = patch.slug;
      if (patch.emailDomain !== undefined) values.email_domain = patch.emailDomain;
      const [row] = await this.db
        .update(core_organisations)
        .set(values)
        .where(eq(core_organisations.id, id))
        .returning();
      if (!row) return err(domainError("NOT_FOUND", "Organisation not found."));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to update organisation.", cause));
    }
  }

  async delete(id: string): Promise<Result<void>> {
    try {
      await this.db.delete(core_organisations).where(eq(core_organisations.id, id));
      return ok(undefined);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to delete organisation.", cause));
    }
  }

  async countMembers(organisationId: string): Promise<Result<number>> {
    try {
      const [row] = await this.db
        .select({ value: count() })
        .from(core_users)
        .where(eq(core_users.organisation_id, organisationId));
      return ok(row?.value ?? 0);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to count organisation members.", cause));
    }
  }
}
