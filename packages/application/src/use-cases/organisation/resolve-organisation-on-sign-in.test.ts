import { describe, expect, it } from "vitest";
import {
  ok,
  type ISystemSettingsRepository,
  type OrganisationResolution,
  type Result,
  type SystemSetting,
  type User,
} from "@rbrasier/domain";
import { ResolveOrganisationOnSignIn } from "./resolve-organisation-on-sign-in";

const ORG = {
  id: "org-hr",
  name: "HR",
  slug: "hr",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const makeUser = (overrides: Partial<User> = {}): User => ({
  id: "user-1",
  email: "person@hr.acme.com",
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

class FakeUsers {
  updates: Array<{ id: string; organisationId: string | null }> = [];
  constructor(private readonly user: User) {}
  async findById(id: string): Promise<Result<User | null>> {
    return ok(id === this.user.id ? this.user : null);
  }
  async update(id: string, patch: { organisationId?: string | null }): Promise<Result<User>> {
    this.updates.push({ id, organisationId: patch.organisationId ?? null });
    return ok({ ...this.user, organisationId: patch.organisationId ?? null });
  }
}

class FakeOrganisations {
  async findById(id: string): Promise<Result<typeof ORG | null>> {
    return ok(id === ORG.id ? ORG : null);
  }
}

class FakeSettings implements Partial<ISystemSettingsRepository> {
  constructor(private readonly config: OrganisationResolution | null) {}
  async get(): Promise<Result<SystemSetting | null>> {
    if (!this.config) return ok(null);
    return ok({
      key: "organisation_resolution",
      value: JSON.stringify(this.config),
      updatedAt: new Date(),
    } as SystemSetting);
  }
}

const build = (user: User, config: OrganisationResolution | null) => {
  const users = new FakeUsers(user);
  const useCase = new ResolveOrganisationOnSignIn(
    users as never,
    new FakeOrganisations() as never,
    new FakeSettings(config) as never,
  );
  return { users, useCase };
};

describe("ResolveOrganisationOnSignIn", () => {
  it("is a no-op when the user already has an organisation", async () => {
    const { users, useCase } = build(makeUser({ organisationId: "org-hr" }), {
      strategy: "email_domain",
      emailDomain: { domainToOrg: [{ domain: "hr.acme.com", organisationId: "org-hr" }], onUnmatched: "unaffiliated" },
    });
    const result = await useCase.execute("user-1");
    expect(result.data).toEqual({ status: "resolved" });
    expect(users.updates).toEqual([]);
  });

  it("auto-assigns a verified matching email domain", async () => {
    const { users, useCase } = build(makeUser(), {
      strategy: "email_domain",
      emailDomain: { domainToOrg: [{ domain: "hr.acme.com", organisationId: "org-hr" }], onUnmatched: "unaffiliated" },
    });
    const result = await useCase.execute("user-1");
    expect(result.data).toEqual({ status: "resolved" });
    expect(users.updates).toEqual([{ id: "user-1", organisationId: "org-hr" }]);
  });

  it("does not assign from an unverified email", async () => {
    const { users, useCase } = build(makeUser({ emailVerified: false }), {
      strategy: "email_domain",
      emailDomain: { domainToOrg: [{ domain: "hr.acme.com", organisationId: "org-hr" }], onUnmatched: "unaffiliated" },
    });
    const result = await useCase.execute("user-1");
    expect(result.data).toEqual({ status: "none" });
    expect(users.updates).toEqual([]);
  });

  it("asks the user to nominate under the self_nomination strategy", async () => {
    const { useCase } = build(makeUser(), {
      strategy: "self_nomination",
      selfNomination: { mode: "create_or_join" },
    });
    const result = await useCase.execute("user-1");
    expect(result.data).toEqual({ status: "nominate" });
  });

  it("asks the user to nominate when email domain is unmatched with onUnmatched=nominate", async () => {
    const { useCase } = build(makeUser({ email: "person@unknown.io" }), {
      strategy: "email_domain",
      emailDomain: { domainToOrg: [], onUnmatched: "nominate" },
    });
    const result = await useCase.execute("user-1");
    expect(result.data).toEqual({ status: "nominate" });
  });

  it("does nothing under the admin strategy", async () => {
    const { users, useCase } = build(makeUser(), { strategy: "admin" });
    const result = await useCase.execute("user-1");
    expect(result.data).toEqual({ status: "none" });
    expect(users.updates).toEqual([]);
  });

  it("does nothing (no claim available post-hoc) under sso_claim", async () => {
    const { useCase } = build(makeUser(), {
      strategy: "sso_claim",
      ssoClaim: { claimName: "org" },
    });
    const result = await useCase.execute("user-1");
    expect(result.data).toEqual({ status: "none" });
  });
});
