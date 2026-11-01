import { describe, expect, it } from "vitest";
import {
  currentAuditActor,
  runWithAuditActor,
  withImpersonationMetadata,
} from "./audit-actor-store";

const ADMIN = "11111111-1111-1111-1111-111111111111";
const TARGET = "22222222-2222-2222-2222-222222222222";

describe("audit actor store", () => {
  it("reports no actor outside any scope", () => {
    expect(currentAuditActor()).toBeNull();
  });

  it("exposes the actor inside the scope", async () => {
    const seen = await runWithAuditActor(
      { userId: TARGET, impersonatorId: ADMIN },
      async () => currentAuditActor(),
    );

    expect(seen).toEqual({ userId: TARGET, impersonatorId: ADMIN });
  });

  it("survives an await inside the scope", async () => {
    const seen = await runWithAuditActor(
      { userId: TARGET, impersonatorId: ADMIN },
      async () => {
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 1));
        return currentAuditActor();
      },
    );

    expect(seen?.impersonatorId).toBe(ADMIN);
  });

  it("does not leak out of the scope", async () => {
    await runWithAuditActor({ userId: TARGET, impersonatorId: ADMIN }, async () => undefined);

    expect(currentAuditActor()).toBeNull();
  });

  it("keeps concurrent scopes isolated from one another", async () => {
    const simulated = runWithAuditActor(
      { userId: TARGET, impersonatorId: ADMIN },
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return currentAuditActor();
      },
    );
    const ordinary = runWithAuditActor(
      { userId: ADMIN, impersonatorId: null },
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return currentAuditActor();
      },
    );

    const [fromSimulated, fromOrdinary] = await Promise.all([simulated, ordinary]);

    expect(fromSimulated).toEqual({ userId: TARGET, impersonatorId: ADMIN });
    expect(fromOrdinary).toEqual({ userId: ADMIN, impersonatorId: null });
  });
});

describe("withImpersonationMetadata", () => {
  const simulating = { userId: TARGET, impersonatorId: ADMIN };

  it("leaves metadata untouched when nobody is impersonating", () => {
    expect(withImpersonationMetadata({ a: 1 }, { userId: ADMIN, impersonatorId: null }))
      .toEqual({ a: 1 });
  });

  it("leaves metadata untouched outside any scope", () => {
    expect(withImpersonationMetadata({ a: 1 }, null)).toEqual({ a: 1 });
  });

  it("keeps null metadata null when nobody is impersonating", () => {
    expect(withImpersonationMetadata(null, null)).toBeNull();
  });

  it("stamps the impersonator onto existing metadata", () => {
    expect(withImpersonationMetadata({ a: 1 }, simulating)).toEqual({
      a: 1,
      impersonated: true,
      impersonatorId: ADMIN,
    });
  });

  it("creates metadata when there was none", () => {
    expect(withImpersonationMetadata(null, simulating)).toEqual({
      impersonated: true,
      impersonatorId: ADMIN,
    });
  });

  it("leaves an explicit impersonatorId alone, so the impersonation.* rows stay clean", () => {
    const explicit = { impersonatorId: ADMIN, durationMs: 1000 };

    expect(withImpersonationMetadata(explicit, simulating)).toEqual(explicit);
    expect(withImpersonationMetadata(explicit, simulating)).not.toHaveProperty("impersonated");
  });
});
