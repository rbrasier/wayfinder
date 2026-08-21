import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GraphClient } from "./graph-client";
import { GraphPeopleDirectory } from "./graph-people-directory";

// @ts-expect-error - .mjs mock, no types
import { mock as graphApi } from "../../../../mocks/graph/api.mjs";
// @ts-expect-error - .mjs mock, no types
import { mock as entraOidc } from "../../../../mocks/entra/oidc.mjs";

let server: Server;
let origin: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const handler = req.url?.startsWith("/graph") ? graphApi : entraOidc;
    void handler.handle(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  origin = `http://localhost:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const client = () =>
  new GraphClient({
    tenantId: "mock-tenant",
    clientId: "mock-client",
    clientSecret: "mock-secret",
    baseUrl: `${origin}/graph/v1.0`,
    authority: `${origin}/entra`,
  });

describe("the real adapters against the real mock", () => {
  it("GraphPeopleDirectory searches and maps people", async () => {
    const result = await new GraphPeopleDirectory(client()).search({ query: "Lovelace", limit: 5 });
    expect(result.error).toBeUndefined();
    expect(result.data?.[0]).toMatchObject({ source: "entra", email: "ada@example.com" });
  });

  it("walks the reporting chain two hops, as level-2 resolution does", async () => {
    const graph = client();
    const first = await graph.get<{ mail: string }>("/users/ada%40example.com/manager", {
      $select: "id,mail,userPrincipalName",
    });
    expect(first.data?.mail).toBe("grace@example.com");
    const second = await graph.get<{ mail: string }>("/users/grace%40example.com/manager", {
      $select: "id,mail,userPrincipalName",
    });
    expect(second.data?.mail).toBe("rosalind.whitfield@example.com");
  });

  it("reports the top of the org as an error, which resolution reads as unresolved", async () => {
    const top = await client().get("/users/rosalind.whitfield%40example.com/manager");
    expect(top.error?.code).toBe("INFRA_FAILURE");
  });
});
