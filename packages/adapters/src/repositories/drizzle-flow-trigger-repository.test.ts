import { describe, expect, it } from "vitest";
import { toFlowTrigger } from "./drizzle-flow-trigger-repository";

const row = {
  id: "trigger-1",
  flow_id: "flow-1",
  kind: "webhook" as const,
  enabled: true,
  token_hash: "a".repeat(64),
  token_last_four: "x9Qz",
  hmac_secret_encrypted: "enc:v1:abc",
  run_as_user_id: "user-1",
  created_by: "user-1",
  last_triggered_at: null,
  created_at: new Date("2026-10-22T00:00:00.000Z"),
  updated_at: new Date("2026-10-22T00:00:00.000Z"),
};

describe("toFlowTrigger", () => {
  it("says whether HMAC is on without carrying the secret or the token hash", () => {
    const trigger = toFlowTrigger(row);

    expect(trigger).toMatchObject({ id: "trigger-1", tokenLastFour: "x9Qz", hasHmacSecret: true });
    expect(JSON.stringify(trigger)).not.toContain("enc:v1:abc");
    expect(JSON.stringify(trigger)).not.toContain("a".repeat(64));
  });

  it("reports HMAC off when no secret is stored", () => {
    expect(toFlowTrigger({ ...row, hmac_secret_encrypted: null }).hasHmacSecret).toBe(false);
  });
});
