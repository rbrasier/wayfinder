import { describe, it, expect } from "vitest";
import {
  domainError,
  err,
  ok,
  type IUserRepository,
  type NewUser,
  type Result,
  type User,
  type UserUpdate,
} from "@rbrasier/domain";
import { SetWelcomeTourCompleted } from "./set-welcome-tour-completed";

const makeUser = (overrides: Partial<User> = {}): User => ({
  id: "user-1",
  email: "dana@example.com",
  name: "Dana Okafor",
  role: null,
  team: null,
  organisationId: null,
  emailVerified: true,
  isAdmin: false,
  welcomeTourCompletedAt: null,
  createdAt: new Date("2026-09-01T09:00:00Z"),
  updatedAt: new Date("2026-09-01T09:00:00Z"),
  ...overrides,
});

class FakeUserRepository implements IUserRepository {
  users: User[];
  updates: { id: string; patch: UserUpdate }[] = [];
  failUpdate = false;

  constructor(initial: User[]) {
    this.users = initial;
  }
  async create(input: NewUser): Promise<Result<User>> {
    return ok(makeUser({ id: `user-${this.users.length + 1}`, email: input.email }));
  }
  async findById(id: string): Promise<Result<User | null>> {
    return ok(this.users.find((user) => user.id === id) ?? null);
  }
  async findByIds(ids: readonly string[]): Promise<Result<User[]>> {
    return ok(this.users.filter((user) => ids.includes(user.id)));
  }
  async findByEmail(email: string): Promise<Result<User | null>> {
    return ok(this.users.find((user) => user.email === email) ?? null);
  }
  async list(): Promise<Result<User[]>> {
    return ok(this.users);
  }
  async search(): Promise<Result<User[]>> {
    return ok([]);
  }
  async update(id: string, patch: UserUpdate): Promise<Result<User>> {
    if (this.failUpdate) return err(domainError("INFRA_FAILURE", "Database is away."));
    this.updates.push({ id, patch });
    const user = this.users.find((candidate) => candidate.id === id);
    if (!user) return err(domainError("NOT_FOUND", `User ${id} not found.`));
    const updated = { ...user, ...patch } as User;
    this.users = this.users.map((candidate) => (candidate.id === id ? updated : candidate));
    return ok(updated);
  }
  async delete(): Promise<Result<true>> {
    return ok(true as const);
  }
}

describe("SetWelcomeTourCompleted", () => {
  it("stamps the moment the tour was completed", async () => {
    const users = new FakeUserRepository([makeUser()]);
    const now = new Date("2026-09-04T10:15:00Z");

    const result = await new SetWelcomeTourCompleted(users).execute("user-1", true, now);

    expect(result.error).toBeUndefined();
    expect(result.data?.welcomeTourCompletedAt).toEqual(now);
    expect(users.updates).toEqual([{ id: "user-1", patch: { welcomeTourCompletedAt: now } }]);
  });

  it("clears the stamp when the tour is restarted, so it shows again", async () => {
    const users = new FakeUserRepository([
      makeUser({ welcomeTourCompletedAt: new Date("2026-09-02T08:00:00Z") }),
    ]);

    const result = await new SetWelcomeTourCompleted(users).execute("user-1", false);

    expect(result.data?.welcomeTourCompletedAt).toBeNull();
  });

  it("refuses an unknown user rather than writing a patch", async () => {
    const users = new FakeUserRepository([makeUser()]);

    const result = await new SetWelcomeTourCompleted(users).execute("user-404", true);

    expect(result.error?.code).toBe("NOT_FOUND");
    expect(users.updates).toEqual([]);
  });

  it("passes a repository failure back as a Result rather than throwing", async () => {
    const users = new FakeUserRepository([makeUser()]);
    users.failUpdate = true;

    const result = await new SetWelcomeTourCompleted(users).execute("user-1", true);

    expect(result.error?.code).toBe("INFRA_FAILURE");
  });
});
