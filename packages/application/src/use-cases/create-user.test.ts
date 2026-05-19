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
import { CreateUser } from "./create-user";

class InMemoryUsers implements IUserRepository {
  private byId = new Map<string, User>();

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

  async list(): Promise<Result<User[]>> {
    return ok([...this.byId.values()]);
  }

  async update(id: string, patch: UserUpdate): Promise<Result<User>> {
    const u = this.byId.get(id);
    if (!u) return err(domainError("NOT_FOUND", "missing"));
    const next: User = { ...u, ...patch, updatedAt: new Date() };
    this.byId.set(id, next);
    return ok(next);
  }

  async delete(id: string): Promise<Result<true>> {
    this.byId.delete(id);
    return ok(true as const);
  }
}

describe("CreateUser", () => {
  it("creates a new user when email is unused", async () => {
    const sut = new CreateUser(new InMemoryUsers());
    const r = await sut.execute({ email: "a@b.com", name: "Ada" });
    expect(r.error).toBeUndefined();
    expect(r.data?.email).toBe("a@b.com");
  });

  it("rejects duplicate email with ALREADY_EXISTS", async () => {
    const repo = new InMemoryUsers();
    const sut = new CreateUser(repo);
    await sut.execute({ email: "a@b.com" });
    const r = await sut.execute({ email: "a@b.com" });
    expect(r.data).toBeUndefined();
    expect(r.error?.code).toBe("ALREADY_EXISTS");
  });
});
