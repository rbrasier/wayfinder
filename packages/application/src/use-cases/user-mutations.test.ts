import { describe, it, expect } from "vitest";
import {
  type IUserRepository,
  type NewUser,
  type Result,
  type User,
  type UserUpdate,
  domainError,
  err,
  ok,
} from "@rbrasier/domain";
import { UpdateUser } from "./update-user";
import { DeleteUser } from "./delete-user";
import { ListUsers } from "./list-users";

class InMemoryUsers implements IUserRepository {
  private byId = new Map<string, User>();

  seed(user: Partial<User> & { email: string }): User {
    const now = new Date();
    const full: User = {
      id: user.id ?? crypto.randomUUID(),
      email: user.email,
      name: user.name ?? null,
      isAdmin: user.isAdmin ?? false,
      createdAt: user.createdAt ?? now,
      updatedAt: user.updatedAt ?? now,
    };
    this.byId.set(full.id, full);
    return full;
  }

  async create(input: NewUser): Promise<Result<User>> {
    const now = new Date();
    const user: User = {
      id: crypto.randomUUID(),
      email: input.email,
      name: input.name ?? null,
      isAdmin: input.isAdmin ?? false,
      createdAt: now,
      updatedAt: now,
    };
    this.byId.set(user.id, user);
    return ok(user);
  }

  async findById(id: string): Promise<Result<User | null>> {
    return ok(this.byId.get(id) ?? null);
  }

  async findByEmail(email: string): Promise<Result<User | null>> {
    const found = [...this.byId.values()].find((u) => u.email === email) ?? null;
    return ok(found);
  }

  async list(opts?: { limit?: number; offset?: number }): Promise<Result<User[]>> {
    let users = [...this.byId.values()];
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? users.length;
    users = users.slice(offset, offset + limit);
    return ok(users);
  }

  async update(id: string, patch: UserUpdate): Promise<Result<User>> {
    const user = this.byId.get(id);
    if (!user) return err(domainError("NOT_FOUND", "missing"));
    const next: User = { ...user, ...patch, updatedAt: new Date() };
    this.byId.set(id, next);
    return ok(next);
  }

  async delete(id: string): Promise<Result<true>> {
    this.byId.delete(id);
    return ok(true as const);
  }
}

describe("UpdateUser", () => {
  it("updates an existing user", async () => {
    const repo = new InMemoryUsers();
    const existing = repo.seed({ email: "ada@example.com", name: "Ada" });
    const sut = new UpdateUser(repo);

    const result = await sut.execute(existing.id, { name: "Ada Lovelace" });

    expect(result.error).toBeUndefined();
    expect(result.data?.name).toBe("Ada Lovelace");
    expect(result.data?.email).toBe("ada@example.com");
  });

  it("returns NOT_FOUND when user does not exist", async () => {
    const sut = new UpdateUser(new InMemoryUsers());

    const result = await sut.execute("non-existent-id", { name: "Ghost" });

    expect(result.data).toBeUndefined();
    expect(result.error?.code).toBe("NOT_FOUND");
  });
});

describe("DeleteUser", () => {
  it("deletes an existing user", async () => {
    const repo = new InMemoryUsers();
    const existing = repo.seed({ email: "ada@example.com" });
    const sut = new DeleteUser(repo);

    const result = await sut.execute(existing.id);

    expect(result.error).toBeUndefined();
    expect(result.data).toBe(true);
  });

  it("returns NOT_FOUND when user does not exist", async () => {
    const sut = new DeleteUser(new InMemoryUsers());

    const result = await sut.execute("non-existent-id");

    expect(result.data).toBeUndefined();
    expect(result.error?.code).toBe("NOT_FOUND");
  });
});

describe("ListUsers", () => {
  it("returns all users from the repository", async () => {
    const repo = new InMemoryUsers();
    repo.seed({ email: "a@example.com" });
    repo.seed({ email: "b@example.com" });
    const sut = new ListUsers(repo);

    const result = await sut.execute();

    expect(result.error).toBeUndefined();
    expect(result.data).toHaveLength(2);
  });

  it("forwards pagination options to the repository", async () => {
    const repo = new InMemoryUsers();
    for (let i = 0; i < 5; i++) repo.seed({ email: `user${i}@example.com` });
    const sut = new ListUsers(repo);

    const result = await sut.execute({ limit: 2, offset: 1 });

    expect(result.error).toBeUndefined();
    expect(result.data).toHaveLength(2);
  });
});
