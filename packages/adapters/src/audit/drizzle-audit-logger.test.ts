import { describe, expect, it, vi } from "vitest";
import type { ILogger, ISiemForwarder } from "@wayfinder/domain";
import { runWithAuditActor } from "./audit-actor-store";
import { DrizzleAuditLogger } from "./drizzle-audit-logger";
import type { Database } from "../db/client";

const ADMIN = "11111111-1111-1111-1111-111111111111";
const TARGET = "22222222-2222-2222-2222-222222222222";

// Captures what the logger actually inserts, and what it fed to the hash, so a
// test can assert the two agree.
const buildDb = () => {
  const inserted: Array<Record<string, unknown>> = [];

  const tx = {
    execute: vi.fn().mockResolvedValue(undefined),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn((row: Record<string, unknown>) => {
        inserted.push(row);
        return { returning: vi.fn().mockResolvedValue([{ id: "audit-row-1" }]) };
      }),
    }),
  };

  const db = {
    transaction: vi.fn(async (callback: (t: typeof tx) => Promise<void>) => callback(tx)),
  } as unknown as Database;

  return { db, inserted };
};

const silentLogger = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
} as unknown as ILogger;

const noopForwarder = {
  forward: vi.fn().mockResolvedValue({ data: true }),
} as unknown as ISiemForwarder;

const buildLogger = () => {
  const { db, inserted } = buildDb();
  const hashInputs: string[] = [];
  const sha256Hex = (input: string) => {
    hashInputs.push(input);
    return "a".repeat(64);
  };
  const logger = new DrizzleAuditLogger(db, noopForwarder, silentLogger, sha256Hex);
  return { logger, inserted, hashInputs };
};

describe("DrizzleAuditLogger impersonation attribution", () => {
  it("writes no impersonation keys outside a simulated session", async () => {
    const { logger, inserted } = buildLogger();

    await logger.log({ action: "flow.published", resourceType: "flow", actorId: TARGET });

    expect(inserted[0]?.metadata).toBeNull();
  });

  it("keeps actor_id as the impersonated user and names the admin in metadata", async () => {
    const { logger, inserted } = buildLogger();

    await runWithAuditActor({ userId: TARGET, impersonatorId: ADMIN }, () =>
      logger.log({ action: "flow.published", resourceType: "flow", actorId: TARGET }),
    );

    expect(inserted[0]?.actor_id).toBe(TARGET);
    expect(inserted[0]?.metadata).toEqual({ impersonated: true, impersonatorId: ADMIN });
  });

  it("preserves the caller's own metadata alongside the impersonator", async () => {
    const { logger, inserted } = buildLogger();

    await runWithAuditActor({ userId: TARGET, impersonatorId: ADMIN }, () =>
      logger.log({
        action: "flow.published",
        resourceType: "flow",
        actorId: TARGET,
        metadata: { flowName: "Onboarding" },
      }),
    );

    expect(inserted[0]?.metadata).toEqual({
      flowName: "Onboarding",
      impersonated: true,
      impersonatorId: ADMIN,
    });
  });

  it("hashes the merged metadata, so attribution is inside the chain", async () => {
    const { logger, hashInputs } = buildLogger();

    await runWithAuditActor({ userId: TARGET, impersonatorId: ADMIN }, () =>
      logger.log({ action: "flow.published", resourceType: "flow", actorId: TARGET }),
    );

    expect(hashInputs.join("")).toContain(ADMIN);
  });

  it("leaves an explicit impersonatorId alone so impersonation.started stays clean", async () => {
    const { logger, inserted } = buildLogger();

    await runWithAuditActor({ userId: TARGET, impersonatorId: ADMIN }, () =>
      logger.log({
        action: "impersonation.started",
        resourceType: "user",
        actorId: ADMIN,
        metadata: { impersonatorId: ADMIN, targetUserId: TARGET },
      }),
    );

    expect(inserted[0]?.actor_id).toBe(ADMIN);
    expect(inserted[0]?.metadata).not.toHaveProperty("impersonated");
  });
});
