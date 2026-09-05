import { beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";

// These tests run the handlers against a real Postgres. That is the point: the
// unit tests fake the container, and what actually breaks a Lambda deployment is
// the container failing to build, connect, or write — none of which a fake sees.
//
// Environment must be set before anything imports the api container, because
// `loadEnv()` reads it at construction and `getContainer()` memoises the result.
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/wayfinder_lambda_test";

process.env.DATABASE_URL = databaseUrl;
process.env.SETTINGS_ENCRYPTION_KEY ??= "0".repeat(64);
// Retention is opt-in; the tick handler has nothing to drive without it.
process.env.RETENTION_ENABLED = "true";
process.env.EXTRACTION_WORKER_ENABLED = "true";
// No scheduler worker is wanted here: the scheduled tick is driven by
// EventBridge against the web app's endpoint, not by a function.
process.env.SCHEDULER_ENABLED = "false";

const sql = postgres(databaseUrl, { max: 2 });

const jobRow = async (name: string) =>
  sql`SELECT name, last_run_at FROM job_registry WHERE name = ${name}`;

beforeAll(async () => {
  // The migrate handler is the schema setup. Running it here rather than
  // shelling out to drizzle-kit means the deployment's own migration path is
  // what prepares the database — the same ordering a real deploy uses.
  const { handler } = await import("./migrate.js");
  await expect(handler()).resolves.toEqual({ migrated: true });
});

describe("migrate handler", () => {
  it("creates the schema, including the pgvector-backed chunk table", async () => {
    const tables = await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
    `;
    const names = tables.map((row) => row.table_name);

    expect(names).toContain("job_registry");
    expect(names).toContain("kb_document_chunks");
  });

  it("is idempotent, so a redeploy that re-invokes it is safe", async () => {
    const { handler } = await import("./migrate.js");

    await expect(handler()).resolves.toEqual({ migrated: true });
  });

  it("refuses to run without a database rather than failing obscurely later", async () => {
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    const { handler } = await import("./migrate.js");

    await expect(handler()).rejects.toThrow(/DATABASE_URL is not set/);

    process.env.DATABASE_URL = saved;
  });
});

describe("tick handlers", () => {
  it("registers the extraction job, which only start() did before", async () => {
    const { handler } = await import("./tick-extraction.js");

    const outcome = await handler();

    expect(outcome).toEqual({ job: "extraction_worker", ticked: true });
    // The gap this closes: a tick-only handler used to ping a row that was
    // never created, leaving the admin job-health page empty (phase §3.1).
    expect(await jobRow("extraction_worker")).toHaveLength(1);
  });

  it("registers the retention job and records the sweep", async () => {
    const { handler } = await import("./tick-retention.js");

    const outcome = await handler();

    expect(outcome).toEqual({ job: "retention_worker", ticked: true });
    expect(await jobRow("retention_worker")).toHaveLength(1);
  });

  it("records a run time, so job health reflects a tick that actually happened", async () => {
    const { handler } = await import("./tick-extraction.js");
    await handler();

    const [row] = await jobRow("extraction_worker");

    expect(row?.last_run_at).toBeInstanceOf(Date);
  });
});

describe("api handler", () => {
  it("answers a Function URL request through the Express app", async () => {
    const { handler } = await import("./api.js");

    const response = (await handler(
      {
        version: "2.0",
        rawPath: "/health",
        rawQueryString: "",
        headers: { host: "wayfinder.example.com" },
        requestContext: {
          accountId: "123456789012",
          apiId: "api",
          domainName: "wayfinder.example.com",
          http: {
            method: "GET",
            path: "/health",
            protocol: "HTTP/1.1",
            sourceIp: "127.0.0.1",
            userAgent: "integration-test",
          },
          requestId: "request-id",
          routeKey: "$default",
          stage: "$default",
          time: "01/Jan/2026:00:00:00 +0000",
          timeEpoch: 1767225600000,
        },
        isBase64Encoded: false,
      },
      {} as never,
      (() => undefined) as never,
    )) as { statusCode: number; body: string };

    // The route reports on real infrastructure, so a degraded 500 is a valid
    // answer here; what matters is that the container built, the Express app
    // mounted, and the Lambda envelope round-tripped.
    expect([200, 500]).toContain(response.statusCode);
    expect(JSON.parse(response.body)).toBeTypeOf("object");
  });
});
