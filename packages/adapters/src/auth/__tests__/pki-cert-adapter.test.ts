import { describe, it, expect, vi } from "vitest";
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
import { PkiCertAdapter, type PkiConfig } from "../pki-cert-adapter";

// ── in-memory user repository fake ──────────────────────────────────────────

class InMemoryUsers implements IUserRepository {
  readonly store = new Map<string, User>();

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
    this.store.set(user.id, user);
    return ok(user);
  }

  async findById(id: string): Promise<Result<User | null>> {
    return ok(this.store.get(id) ?? null);
  }

  async findByEmail(email: string): Promise<Result<User | null>> {
    const found = [...this.store.values()].find((u) => u.email === email) ?? null;
    return ok(found);
  }

  async list(): Promise<Result<User[]>> {
    return ok([...this.store.values()]);
  }

  async update(id: string, patch: UserUpdate): Promise<Result<User>> {
    const user = this.store.get(id);
    if (!user) return err(domainError("NOT_FOUND", `User ${id} not found.`));
    const next: User = { ...user, ...patch, updatedAt: new Date() };
    this.store.set(id, next);
    return ok(next);
  }

  async delete(id: string): Promise<Result<true>> {
    this.store.delete(id);
    return ok(true as const);
  }
}

// ── minimal db mock ──────────────────────────────────────────────────────────

const makeDbMock = () => {
  const insertedSessions: Array<{ user_id: string; token: string; expires_at: Date }> = [];
  const updatedCertFields: Array<{ userId: string; fingerprint: string; subjectDn: string }> = [];

  const db = {
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockImplementation((v) => {
        insertedSessions.push(v);
        return Promise.resolve(undefined);
      }),
    }),
    _insertedSessions: insertedSessions,
    _updatedCertFields: updatedCertFields,
  };

  return db as unknown as Parameters<typeof PkiCertAdapter.prototype.authenticate>[0] extends never
    ? never
    : ReturnType<typeof makePkiAdapter> extends { db: infer D }
      ? D
      : never;
};

// ── helpers ──────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: PkiConfig = {
  trustedProxyIps: ["10.0.0.1"],
  sessionTtlHours: 8,
};

const validHeaders = (overrides: Record<string, string | null> = {}): Headers => {
  const defaults: Record<string, string> = {
    "x-ssl-client-verified": "SUCCESS",
    "x-ssl-client-subject-dn": "CN=Jane Smith,OU=Eng,O=Acme",
    "x-ssl-client-fingerprint": "sha256:abc123",
    "x-ssl-client-san-email": "jane@acme.com",
  };
  const headers = new Headers();
  for (const [key, value] of Object.entries({ ...defaults, ...overrides })) {
    if (value !== null) headers.set(key, value);
  }
  return headers;
};

const makePkiAdapter = (config = DEFAULT_CONFIG, db?: ReturnType<typeof makeDbMock>) => {
  const users = new InMemoryUsers();
  const resolvedDb = db ?? makeDbMock();
  const adapter = new PkiCertAdapter(resolvedDb as never, users, config);
  return { adapter, users, db: resolvedDb };
};

// ── tests ────────────────────────────────────────────────────────────────────

describe("PkiCertAdapter", () => {
  describe("constructor", () => {
    it("throws when trustedProxyIps is empty", () => {
      const users = new InMemoryUsers();
      expect(
        () => new PkiCertAdapter(makeDbMock() as never, users, { trustedProxyIps: [], sessionTtlHours: 8 }),
      ).toThrow("PKI_TRUSTED_PROXY_IPS must not be empty");
    });
  });

  describe("authenticate — trusted proxy check", () => {
    it("returns UNAUTHORIZED when source IP is not in the trusted list", async () => {
      const { adapter } = makePkiAdapter();
      const result = await adapter.authenticate(validHeaders(), "192.168.99.1");
      expect(result.error?.code).toBe("UNAUTHORIZED");
      expect(result.error?.message).toMatch(/trusted proxy/i);
    });

    it("passes through when source IP matches a trusted proxy", async () => {
      const { adapter } = makePkiAdapter();
      const result = await adapter.authenticate(validHeaders(), "10.0.0.1");
      expect(result.error).toBeUndefined();
    });
  });

  describe("authenticate — certificate verification", () => {
    it("returns UNAUTHORIZED when X-SSL-Client-Verified is FAILED", async () => {
      const { adapter } = makePkiAdapter();
      const result = await adapter.authenticate(
        validHeaders({ "x-ssl-client-verified": "FAILED" }),
        "10.0.0.1",
      );
      expect(result.error?.code).toBe("UNAUTHORIZED");
    });

    it("returns UNAUTHORIZED when X-SSL-Client-Verified is missing", async () => {
      const { adapter } = makePkiAdapter();
      const result = await adapter.authenticate(
        validHeaders({ "x-ssl-client-verified": null }),
        "10.0.0.1",
      );
      expect(result.error?.code).toBe("UNAUTHORIZED");
    });
  });

  describe("authenticate — identity extraction", () => {
    it("uses SAN email when present", async () => {
      const { adapter, users } = makePkiAdapter();
      const result = await adapter.authenticate(validHeaders(), "10.0.0.1");
      expect(result.error).toBeUndefined();
      const created = [...users.store.values()].find((u) => u.email === "jane@acme.com");
      expect(created).toBeDefined();
    });

    it("falls back to CN when CN is an email address and SAN email is absent", async () => {
      const { adapter, users } = makePkiAdapter();
      const result = await adapter.authenticate(
        validHeaders({
          "x-ssl-client-san-email": null,
          "x-ssl-client-subject-dn": "CN=bob@acme.com,O=Acme",
        }),
        "10.0.0.1",
      );
      expect(result.error).toBeUndefined();
      const created = [...users.store.values()].find((u) => u.email === "bob@acme.com");
      expect(created).toBeDefined();
    });

    it("returns VALIDATION_FAILED when SAN email absent and CN is not an email", async () => {
      const { adapter } = makePkiAdapter();
      const result = await adapter.authenticate(
        validHeaders({
          "x-ssl-client-san-email": null,
          "x-ssl-client-subject-dn": "CN=Jane Smith,O=Acme",
        }),
        "10.0.0.1",
      );
      expect(result.error?.code).toBe("VALIDATION_FAILED");
    });

    it("returns VALIDATION_FAILED when Subject-DN header is missing", async () => {
      const { adapter } = makePkiAdapter();
      const result = await adapter.authenticate(
        validHeaders({ "x-ssl-client-subject-dn": null }),
        "10.0.0.1",
      );
      expect(result.error?.code).toBe("VALIDATION_FAILED");
    });

    it("returns VALIDATION_FAILED when Fingerprint header is missing", async () => {
      const { adapter } = makePkiAdapter();
      const result = await adapter.authenticate(
        validHeaders({ "x-ssl-client-fingerprint": null }),
        "10.0.0.1",
      );
      expect(result.error?.code).toBe("VALIDATION_FAILED");
    });
  });

  describe("authenticate — JIT user provisioning", () => {
    it("creates a new user on first login", async () => {
      const { adapter, users } = makePkiAdapter();
      expect(users.store.size).toBe(0);
      await adapter.authenticate(validHeaders(), "10.0.0.1");
      expect(users.store.size).toBe(1);
      const user = [...users.store.values()][0];
      expect(user.email).toBe("jane@acme.com");
      expect(user.isAdmin).toBe(false);
    });

    it("does not create a duplicate on repeated login", async () => {
      const { adapter, users } = makePkiAdapter();
      await adapter.authenticate(validHeaders(), "10.0.0.1");
      await adapter.authenticate(validHeaders(), "10.0.0.1");
      expect(users.store.size).toBe(1);
    });

    it("uses CN as display name when name is derivable", async () => {
      const { adapter, users } = makePkiAdapter();
      await adapter.authenticate(validHeaders(), "10.0.0.1");
      const user = [...users.store.values()][0];
      expect(user.name).toBe("Jane Smith");
    });
  });

  describe("authenticate — session creation", () => {
    it("returns a token and userId on success", async () => {
      const { adapter } = makePkiAdapter();
      const result = await adapter.authenticate(validHeaders(), "10.0.0.1");
      expect(result.error).toBeUndefined();
      expect(result.data?.token).toBeTruthy();
      expect(result.data?.userId).toBeTruthy();
    });

    it("creates a session record in the database", async () => {
      const db = makeDbMock();
      const { adapter } = makePkiAdapter(DEFAULT_CONFIG, db);
      await adapter.authenticate(validHeaders(), "10.0.0.1");
      expect(db.insert).toHaveBeenCalled();
    });
  });

  describe("authenticate — cert field update", () => {
    it("calls db.update on every login to refresh cert_fingerprint and cert_subject_dn", async () => {
      const db = makeDbMock();
      const { adapter } = makePkiAdapter(DEFAULT_CONFIG, db);
      await adapter.authenticate(validHeaders(), "10.0.0.1");
      expect(db.update).toHaveBeenCalled();
    });
  });
});
