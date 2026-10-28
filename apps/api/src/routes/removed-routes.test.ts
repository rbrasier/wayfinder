import type { AddressInfo } from "net";
import type { Server } from "http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import type { Container } from "../container.js";

const RECORD_ID = "7f1c2b9e-3a4d-4e5f-8a6b-1c2d3e4f5a6b";

// User and error management live in the web app's tRPC routers, behind Better
// Auth. The API once mounted unauthenticated copies of them; they must stay gone.
const removedRoutes = [
  { method: "GET", path: "/v1/users" },
  { method: "POST", path: "/v1/users" },
  { method: "PATCH", path: `/v1/users/${RECORD_ID}` },
  { method: "DELETE", path: `/v1/users/${RECORD_ID}` },
  { method: "POST", path: "/v1/errors" },
  { method: "GET", path: "/v1/errors/grouped" },
  { method: "PATCH", path: "/v1/errors/status" },
] as const;

let server: Server | null = null;

const start = (): string => {
  const container = {
    env: {},
    useCases: {},
    services: { errorLogger: { log: vi.fn() } },
  } as unknown as Container;
  server = buildApp(container).listen(0);
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
};

afterEach(() => {
  server?.close();
  server = null;
});

describe("removed management routes", () => {
  it.each(removedRoutes)("$method $path is not served", async ({ method, path }) => {
    const baseUrl = start();

    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "GET" || method === "DELETE" ? undefined : JSON.stringify({ email: "x@example.com", isAdmin: true }),
    });

    expect(response.status).toBe(404);
  });
});
