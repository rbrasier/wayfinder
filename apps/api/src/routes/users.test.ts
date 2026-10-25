import type { AddressInfo } from "net";
import type { Server } from "http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import type { Container } from "../container.js";

const SERVICE_KEY = "test-service-key-0123456789abcdef";
const USER_ID = "7f1c2b9e-3a4d-4e5f-8a6b-1c2d3e4f5a6b";

const makeUseCases = () => ({
  listUsers: { execute: vi.fn().mockResolvedValue({ data: { items: [], total: 0 } }) },
  createUser: { execute: vi.fn().mockResolvedValue({ data: { id: USER_ID } }) },
  updateUser: { execute: vi.fn().mockResolvedValue({ data: { id: USER_ID } }) },
  deleteUser: { execute: vi.fn().mockResolvedValue({ data: undefined }) },
});

const makeContainer = (apiServiceKey: string | undefined, useCases: ReturnType<typeof makeUseCases>) =>
  ({
    env: { API_SERVICE_KEY: apiServiceKey },
    useCases,
    services: { errorLogger: { log: vi.fn() } },
  }) as unknown as Container;

const routes = [
  { name: "GET /", method: "GET", path: "/v1/users", useCase: "listUsers", body: undefined },
  {
    name: "POST /",
    method: "POST",
    path: "/v1/users",
    useCase: "createUser",
    body: { email: "new@example.com", name: "New User", isAdmin: true },
  },
  {
    name: "PATCH /:id",
    method: "PATCH",
    path: `/v1/users/${USER_ID}`,
    useCase: "updateUser",
    body: { id: USER_ID, email: "changed@example.com" },
  },
  { name: "DELETE /:id", method: "DELETE", path: `/v1/users/${USER_ID}`, useCase: "deleteUser", body: undefined },
] as const;

let server: Server | null = null;

const start = (container: Container): string => {
  server = buildApp(container).listen(0);
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
};

const send = (baseUrl: string, route: (typeof routes)[number], authorization: string | null) => {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authorization) headers.Authorization = authorization;
  return fetch(`${baseUrl}${route.path}`, {
    method: route.method,
    headers,
    body: route.body ? JSON.stringify(route.body) : undefined,
  });
};

afterEach(() => {
  server?.close();
  server = null;
});

describe.each(routes)("$name /v1/users authentication", (route) => {
  it("refuses a request with no Authorization header", async () => {
    const useCases = makeUseCases();
    const baseUrl = start(makeContainer(SERVICE_KEY, useCases));

    const response = await send(baseUrl, route, null);

    expect(response.status).toBe(401);
    expect(useCases[route.useCase].execute).not.toHaveBeenCalled();
  });

  it("refuses a request with the wrong key", async () => {
    const useCases = makeUseCases();
    const baseUrl = start(makeContainer(SERVICE_KEY, useCases));

    const response = await send(baseUrl, route, "Bearer not-the-key");

    expect(response.status).toBe(401);
    expect(useCases[route.useCase].execute).not.toHaveBeenCalled();
  });

  it("refuses every request when no service key is configured", async () => {
    const useCases = makeUseCases();
    const baseUrl = start(makeContainer(undefined, useCases));

    const response = await send(baseUrl, route, "Bearer ");

    expect(response.status).toBe(401);
    expect(useCases[route.useCase].execute).not.toHaveBeenCalled();
  });

  it("reaches the use case with the configured key", async () => {
    const useCases = makeUseCases();
    const baseUrl = start(makeContainer(SERVICE_KEY, useCases));

    const response = await send(baseUrl, route, `Bearer ${SERVICE_KEY}`);

    expect(response.status).toBeLessThan(300);
    expect(useCases[route.useCase].execute).toHaveBeenCalledTimes(1);
  });
});
