import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { buildClaimDueWatchesStatement, toEventWatch } from "./drizzle-event-watch-repository";

describe("buildClaimDueWatchesStatement", () => {
  const now = new Date("2026-10-22T00:00:00.000Z");
  const render = () => new PgDialect().sqlToQuery(buildClaimDueWatchesStatement(now, 10));

  it("claims active, due watches with skip-locked and moves each one's next poll on by its interval", () => {
    const text = render().sql.toLowerCase();

    expect(text).toContain("for update skip locked");
    expect(text).toContain("status = 'active'");
    expect(text).toContain("interval_minutes");
    expect(text).toContain("returning");
  });

  it("binds now as an ISO timestamp and bounds the batch", () => {
    const { params } = render();

    expect(params).toContain(now.toISOString());
    expect(params).toContain(10);
  });
});

describe("toEventWatch", () => {
  it("says whether a secret is stored without carrying it", () => {
    const watch = toEventWatch({
      id: "watch-1",
      name: "Hearings",
      url: "https://api.example.com",
      method: "GET",
      request_body: null,
      auth_type: "bearer",
      api_key_placement: null,
      secret_encrypted: "enc:v1:secret",
      interval_minutes: 2,
      items_path: "data",
      item_id_path: "id",
      condition: { kind: "new_item" },
      fire_once_per_item: true,
      max_runs_per_poll: 20,
      flow_id: "flow-1",
      input_mapping: {},
      run_as_user_id: "user-1",
      status: "active",
      baseline_pending: true,
      consecutive_failures: 0,
      failure_threshold: 5,
      last_error: null,
      paused_reason: null,
      paused_at: null,
      pause_incident_id: null,
      last_polled_at: null,
      last_success_at: null,
      next_poll_at: null,
      created_by: "user-1",
      created_at: new Date(0),
      updated_at: new Date(0),
    });

    expect(watch.hasSecret).toBe(true);
    expect(JSON.stringify(watch)).not.toContain("enc:v1:secret");
  });
});
