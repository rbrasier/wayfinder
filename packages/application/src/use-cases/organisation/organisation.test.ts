import { describe, expect, it } from "vitest";
import {
  ok,
  type IOrganisationRepository,
  type IUserRepository,
  type NewOrganisation,
  type Organisation,
  type OrganisationUpdate,
  type Result,
  type User,
  type UserUpdate,
} from "@rbrasier/domain";
import { CreateOrganisation } from "./create-organisation";
import { DeleteOrganisation } from "./delete-organisation";
import { AssignUserOrganisation } from "./assign-user-organisation";

class FakeOrganisationRepository implements IOrganisationRepository {
  private readonly rows = new Map<string, Organisation>();
  private sequence = 0;
  memberCounts = new Map<string, number>();

  seed(organisation: Organisation): void {
    this.rows.set(organisation.id, organisation);
  }

  async list(): Promise<Result<Organisation[]>> {
    return ok([...this.rows.values()]);
  }

  async findById(id: string): Promise<Result<Organisation | null>> {
    return ok(this.rows.get(id) ?? null);
  }

  async findBySlug(slug: string): Promise<Result<Organisation | null>> {
    return ok([...this.rows.values()].find((row) => row.slug === slug) ?? null);
  }

  async create(organisation: NewOrganisation): Promise<Result<Organisation>> {
    this.sequence += 1;
    const row: Organisation = {
      id: `org-${this.sequence}`,
      name: organisation.name,
      slug: organisation.slug,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.rows.set(row.id, row);
    return ok(row);
  }

  async update(id: string, patch: OrganisationUpdate): Promise<Result<Organisation>> {
    const existing = this.rows.get(id)!;
    const updated = { ...existing, ...patch, updatedAt: new Date() };
    this.rows.set(id, updated);
    return ok(updated);
  }

  async delete(id: string): Promise<Result<void>> {
    this.rows.delete(id);
    return ok(undefined);
  }

  async countMembers(organisationId: string): Promise<Result<number>> {
    return ok(this.memberCounts.get(organisationId) ?? 0);
  }
}

class FakeUserRepository implements Partial<IUserRepository> {
  updates: Array<{ id: string; patch: UserUpdate }> = [];
  private readonly rows = new Map<string, User>();

  seed(user: User): void {
    this.rows.set(user.id, user);
  }

  async findById(id: string): Promise<Result<User | null>> {
    return ok(this.rows.get(id) ?? null);
  }

  async update(id: string, patch: UserUpdate): Promise<Result<User>> {
    this.updates.push({ id, patch });
    const existing = this.rows.get(id)!;
    const updated = { ...existing, ...patch, updatedAt: new Date() };
    this.rows.set(id, updated);
    return ok(updated);
  }
}

const makeUser = (overrides: Partial<User> = {}): User => ({
  id: "user-1",
  email: "person@example.com",
  name: null,
  role: null,
  team: null,
  organisationId: null,
  emailVerified: true,
  isAdmin: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe("CreateOrganisation", () => {
  it("slugifies the name", async () => {
    const organisations = new FakeOrganisationRepository();
    const result = await new CreateOrganisation(organisations).execute({ name: "Procurement Team" });
    expect(result.error).toBeUndefined();
    expect(result.data?.slug).toBe("procurement-team");
    expect(result.data?.name).toBe("Procurement Team");
  });

  it("appends a numeric suffix when the slug already exists", async () => {
    const organisations = new FakeOrganisationRepository();
    organisations.seed({
      id: "existing",
      name: "HR",
      slug: "hr",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const result = await new CreateOrganisation(organisations).execute({ name: "HR" });
    expect(result.data?.slug).toBe("hr-2");
  });

  it("rejects a blank name", async () => {
    const organisations = new FakeOrganisationRepository();
    const result = await new CreateOrganisation(organisations).execute({ name: "   " });
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });
});

describe("DeleteOrganisation", () => {
  it("deletes an empty organisation", async () => {
    const organisations = new FakeOrganisationRepository();
    organisations.seed({
      id: "org-1",
      name: "HR",
      slug: "hr",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const result = await new DeleteOrganisation(organisations).execute("org-1");
    expect(result.error).toBeUndefined();
  });

  it("refuses to delete an organisation that still has members", async () => {
    const organisations = new FakeOrganisationRepository();
    organisations.seed({
      id: "org-1",
      name: "HR",
      slug: "hr",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    organisations.memberCounts.set("org-1", 3);
    const result = await new DeleteOrganisation(organisations).execute("org-1");
    expect(result.error?.code).toBe("CONFLICT");
  });
});

describe("AssignUserOrganisation", () => {
  it("assigns a user to an existing organisation", async () => {
    const organisations = new FakeOrganisationRepository();
    organisations.seed({
      id: "org-1",
      name: "HR",
      slug: "hr",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const users = new FakeUserRepository();
    users.seed(makeUser());
    const useCase = new AssignUserOrganisation(users as IUserRepository, organisations);
    const result = await useCase.execute({ userId: "user-1", organisationId: "org-1" });
    expect(result.error).toBeUndefined();
    expect(users.updates).toEqual([{ id: "user-1", patch: { organisationId: "org-1" } }]);
  });

  it("clears a user's organisation when passed null", async () => {
    const organisations = new FakeOrganisationRepository();
    const users = new FakeUserRepository();
    users.seed(makeUser({ organisationId: "org-1" }));
    const useCase = new AssignUserOrganisation(users as IUserRepository, organisations);
    const result = await useCase.execute({ userId: "user-1", organisationId: null });
    expect(result.error).toBeUndefined();
    expect(users.updates).toEqual([{ id: "user-1", patch: { organisationId: null } }]);
  });

  it("rejects assigning to an organisation that does not exist", async () => {
    const organisations = new FakeOrganisationRepository();
    const users = new FakeUserRepository();
    users.seed(makeUser());
    const useCase = new AssignUserOrganisation(users as IUserRepository, organisations);
    const result = await useCase.execute({ userId: "user-1", organisationId: "ghost" });
    expect(result.error?.code).toBe("NOT_FOUND");
    expect(users.updates).toEqual([]);
  });
});
