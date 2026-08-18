import { describe, it, expect, vi } from "vitest";
import {
  domainError,
  err,
  ok,
  type AuthConfig,
  type IUserRepository,
  type NewUser,
  type Result,
  type User,
  type UserUpdate,
} from "@rbrasier/domain";
import { DEFAULT_SESSION_POLICY } from "@rbrasier/domain";
import { createSessionRevocationRegistry } from "../session-revocation";
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
      role: input.role ?? null,
      team: input.team ?? null,
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

  async search(input: { query: string; limit: number }): Promise<Result<User[]>> {
    const term = input.query.trim().toLowerCase();
    if (term.length === 0) return ok([]);
    const matches = [...this.rows.values()].filter(
      (row) =>
        row.email.toLowerCase().includes(term) ||
        (row.name ?? "").toLowerCase().includes(term),
    );
    return ok(matches.slice(0, input.limit));
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
};

// Stands in for RuntimeConfigStore: the adapter reads the switch and the TTL
// from it on every request, so a settings change applies with no restart.
const makeAuthConfigSource = (overrides: Partial<AuthConfig> = {}) => {
  let config: AuthConfig = {
    emailPasswordEnabled: true,
    entraEnabled: false,
    entra: { tenantId: "", clientId: "", clientSecret: "" },
    pkiEnabled: true,
    pki: { sessionTtlHours: 8 },
    sessionPolicy: DEFAULT_SESSION_POLICY,
    ...overrides,
  };
  return {
    getAuthConfig: async (): Promise<AuthConfig> => config,
    set: (next: Partial<AuthConfig>): void => {
      config = { ...config, ...next };
    },
  };
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

const makePkiAdapter = (
  config = DEFAULT_CONFIG,
  db?: ReturnType<typeof makeDbMock>,
  authConfig = makeAuthConfigSource(),
) => {
  const users = new InMemoryUsers();
  const resolvedDb = db ?? makeDbMock();
  const adapter = new PkiCertAdapter(
    resolvedDb as never,
    users,
    config,
    authConfig,
    createSessionRevocationRegistry(),
  );
  return { adapter, users, db: resolvedDb, authConfig };
};

// ── tests ────────────────────────────────────────────────────────────────────

describe("PkiCertAdapter", () => {
  describe("constructor", () => {
    // The adapter is built unconditionally now; an empty list is a runtime
    // state to report, not a reason to refuse to boot.
    it("constructs with an empty trusted-proxy list instead of throwing", () => {
      const users = new InMemoryUsers();
      expect(
        () =>
          new PkiCertAdapter(
            makeDbMock() as never,
            users,
            { trustedProxyIps: [] },
            makeAuthConfigSource(),
            createSessionRevocationRegistry(),
          ),
      ).not.toThrow();
    });
  });

  describe("authenticate — configuration gates", () => {
    it("returns INFRA_FAILURE and mints no session when the trusted-proxy list is empty", async () => {
      const { adapter, db } = makePkiAdapter({ trustedProxyIps: [] });

      const result = await adapter.authenticate(validHeaders(), "10.0.0.1");

      expect(result.error?.code).toBe("INFRA_FAILURE");
      expect(result.error?.message).toMatch(/PKI_TRUSTED_PROXY_IPS/);
      expect((db as never as { _insertedSessions: unknown[] })._insertedSessions).toHaveLength(0);
    });

    it("refuses when PKI is disabled in config, whatever the caller", async () => {
      const authConfig = makeAuthConfigSource({ pkiEnabled: false });
      const { adapter, db } = makePkiAdapter(DEFAULT_CONFIG, undefined, authConfig);

      const result = await adapter.authenticate(validHeaders(), "10.0.0.1");

      expect(result.error?.code).toBe("UNAUTHORIZED");
      expect((db as never as { _insertedSessions: unknown[] })._insertedSessions).toHaveLength(0);
    });
  });

  describe("authenticate — session TTL", () => {
    it("resolves the TTL from config on each request, with no restart", async () => {
      const authConfig = makeAuthConfigSource({ pki: { sessionTtlHours: 8 } });
      const { adapter, db } = makePkiAdapter(DEFAULT_CONFIG, undefined, authConfig);
      const sessions = (db as never as { _insertedSessions: Array<{ expires_at: Date }> })
        ._insertedSessions;

      await adapter.authenticate(validHeaders(), "10.0.0.1");
      authConfig.set({ pki: { sessionTtlHours: 24 } });
      await adapter.authenticate(validHeaders(), "10.0.0.1");

      const hoursFromNow = (date: Date) => Math.round((date.getTime() - Date.now()) / 3_600_000);
      expect(hoursFromNow(sessions[0]!.expires_at)).toBe(8);
      expect(hoursFromNow(sessions[1]!.expires_at)).toBe(24);
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

  // The certificate is the credential, but the email address inside it is the
  // account key — the same rule Entra sign-in follows. cert_fingerprint and
  // cert_subject_dn are written on every login and never read to find a user,
  // so a re-issued certificate keeps the account and a new address never
  // reuses one.
  describe("authenticate — the address is the account key", () => {
    it("adopts an account that already exists at the certificate's address", async () => {
      const { adapter, users } = makePkiAdapter();
      const existing = await users.create({ email: "jane@acme.com", name: "Jane Smith" });

      await adapter.authenticate(validHeaders(), "10.0.0.1");

      expect(users.store.size).toBe(1);
      expect(existing.data?.id).toBeDefined();
      const result = await adapter.authenticate(validHeaders(), "10.0.0.1");
      expect(result.data?.userId).toBe(existing.data?.id);
    });

    it("matches an existing lowercase account when the certificate is issued in mixed case", async () => {
      const { adapter, users } = makePkiAdapter();
      const existing = await users.create({ email: "jane@acme.com", name: "Jane Smith" });

      const result = await adapter.authenticate(
        validHeaders({ "x-ssl-client-san-email": "Jane@ACME.com" }),
        "10.0.0.1",
      );

      expect(users.store.size).toBe(1);
      expect(result.data?.userId).toBe(existing.data?.id);
    });

    it("does not key on the fingerprint — one certificate naming a new address provisions a new account", async () => {
      const { adapter, users } = makePkiAdapter();
      await adapter.authenticate(validHeaders(), "10.0.0.1");

      await adapter.authenticate(
        validHeaders({ "x-ssl-client-san-email": "someone-else@acme.com" }),
        "10.0.0.1",
      );

      expect(users.store.size).toBe(2);
    });

    it("keeps one account when the same person's certificate is re-issued with a new fingerprint", async () => {
      const { adapter, users } = makePkiAdapter();
      const first = await adapter.authenticate(validHeaders(), "10.0.0.1");

      const second = await adapter.authenticate(
        validHeaders({ "x-ssl-client-fingerprint": "sha256:rotated999" }),
        "10.0.0.1",
      );

      expect(users.store.size).toBe(1);
      expect(second.data?.userId).toBe(first.data?.userId);
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
