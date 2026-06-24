import { beforeEach, describe, expect, it, vi } from "vitest";

const postgresMock = vi.fn(() => ({}) as unknown);
const drizzleMock = vi.fn(() => ({}) as unknown);

vi.mock("postgres", () => ({ default: (...args: unknown[]) => postgresMock(...args) }));
vi.mock("drizzle-orm/postgres-js", () => ({ drizzle: (...args: unknown[]) => drizzleMock(...args) }));

import { createDatabase } from "../client";

const databaseUrl = "postgres://user:pass@localhost:5432/wayfinder_test";

describe("createDatabase", () => {
  beforeEach(() => {
    postgresMock.mockClear();
    drizzleMock.mockClear();
  });

  it("defaults the connection pool to a small dev-safe size when none is given", () => {
    createDatabase(databaseUrl);
    expect(postgresMock).toHaveBeenCalledWith(databaseUrl, { max: 10 });
  });

  it("uses the provided pool size so deployments can tune connections per instance", () => {
    createDatabase(databaseUrl, 25);
    expect(postgresMock).toHaveBeenCalledWith(databaseUrl, { max: 25 });
  });
});
