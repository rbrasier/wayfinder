import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DIRECTORY_CONFIG_SETTING_KEY,
  EMAIL_CONFIG_SETTING_KEY,
  createDefaultAuthConfig,
  type AuthConfig,
  type EntraCredentials,
  type ISystemSettingsRepository,
} from "@rbrasier/domain";
import { RuntimeConfigStore } from "../config/runtime-config-store";
import { probeAuthEntra } from "../health/connectivity-probes";
import { GraphClient } from "./graph-client";
import { GraphPeopleDirectory } from "./graph-people-directory";

// @ts-expect-error - .mjs mock, no types
import { mock as graphApi } from "../../../../mocks/graph/api.mjs";
// @ts-expect-error - .mjs mock, no types
import { mock as entraOidc } from "../../../../mocks/entra/oidc.mjs";
// @ts-expect-error - .mjs mock, no types
import { certificateHeadersFor } from "../../../../mocks/pki/proxy.mjs";
import { commonNameFrom, emailAddressFrom } from "../auth/subject-dn";
import { userInfoFromIdToken } from "../auth/entra-user-info";

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

// What an operator actually does with the mock: leave the host overrides to the
// environment (restart.sh --with-mocks exports them), then switch the directory
// on and paste the mock credentials into /admin/settings. This drives that exact
// path — a real RuntimeConfigStore over a stored settings row — rather than the
// fixed config the tests above use, so a regression in the runtime-config wiring
// cannot pass while the adapters still work.
describe("the admin-configured directory against the real mock", () => {
  const hostOverrides = () => ({
    baseUrl: `${origin}/graph/v1.0`,
    authority: `${origin}/entra`,
  });

  const storeOver = (rows: Record<string, string>) =>
    new RuntimeConfigStore(
      {
        get: async (key: string) => ({
          data: rows[key] ? { key, value: rows[key], updatedAt: new Date() } : null,
        }),
        set: async () => ({ data: undefined }),
        list: async () => ({ data: [] }),
        delete: async () => ({ data: undefined }),
      } as unknown as ISystemSettingsRepository,
      {
        provider: "anthropic",
        apiKeys: { anthropic: null, openai: null, mistral: null, bedrock: null },
        storage: {
          endpoint: "localhost",
          port: 9000,
          useSSL: false,
          accessKey: "ak",
          secretKey: "sk",
          bucket: "wayfinder-documents",
          region: "",
          pathStyle: true,
        },
        embeddingsProvider: "local",
      },
    );

  const clientOver = (rows: Record<string, string>) => {
    const store = storeOver(rows);
    return new GraphClient(async () => {
      const credentials = await store.getDirectoryCredentials();
      return credentials ? { ...credentials, ...hostOverrides() } : null;
    });
  };

  const mockCredentials = {
    tenantId: "mock-tenant",
    clientId: "mock-client",
    clientSecret: "mock-secret",
  };

  const enabledRow = (credentialSource: string, entra = mockCredentials) =>
    JSON.stringify({ enabled: true, credentialSource, entra });

  it("resolves people once an admin saves separate credentials", async () => {
    const graph = clientOver({ [DIRECTORY_CONFIG_SETTING_KEY]: enabledRow("own") });

    const result = await new GraphPeopleDirectory(graph).search({ query: "Lovelace", limit: 5 });

    expect(result.data?.[0]).toMatchObject({ source: "entra", email: "ada@example.com" });
  });

  it("resolves people when the admin inherits the email card's app registration", async () => {
    const graph = clientOver({
      [DIRECTORY_CONFIG_SETTING_KEY]: enabledRow("email", {
        tenantId: "",
        clientId: "",
        clientSecret: "",
      }),
      [EMAIL_CONFIG_SETTING_KEY]: JSON.stringify({
        provider: "m365",
        fromAddress: "noreply@example.com",
        m365TenantId: mockCredentials.tenantId,
        m365ClientId: mockCredentials.clientId,
        m365ClientSecret: mockCredentials.clientSecret,
      }),
    });

    const result = await new GraphPeopleDirectory(graph).search({ query: "Lovelace", limit: 5 });

    expect(result.data?.[0]).toMatchObject({ source: "entra", email: "ada@example.com" });
  });

  it("stays dark while the directory is switched off, whatever is stored", async () => {
    const graph = clientOver({
      [DIRECTORY_CONFIG_SETTING_KEY]: JSON.stringify({
        enabled: false,
        credentialSource: "own",
        entra: mockCredentials,
      }),
    });

    expect(await graph.isConfigured()).toBe(false);
    expect((await new GraphPeopleDirectory(graph).search({ query: "Lovelace", limit: 5 })).data).toEqual([]);
  });

  it("walks the reporting chain for an admin-configured directory", async () => {
    const graph = clientOver({ [DIRECTORY_CONFIG_SETTING_KEY]: enabledRow("own") });

    const manager = await graph.get<{ mail: string }>("/users/ada%40example.com/manager", {
      $select: "id,mail,userPrincipalName",
    });

    expect(manager.data?.mail).toBe("grace@example.com");
  });
});

// The Authentication card's Test, run against the mock exactly as an operator
// runs it. It fetches the discovery document before it will attempt a grant, so
// a mock that only served /authorize and /token failed this with HTTP 404 while
// sign-in itself worked — the kind of gap only driving the real probe finds.
describe("the Entra mock against the real sign-in probe", () => {
  const authConfig = (entra: EntraCredentials): AuthConfig => ({
    ...createDefaultAuthConfig(),
    entraEnabled: true,
    entra,
  });

  const mockEntra = { tenantId: "mock-tenant", clientId: "mock-client", clientSecret: "mock-secret" };

  it("passes against the mock authority", async () => {
    const result = await probeAuthEntra(authConfig(mockEntra), {
      authority: `${origin}/entra`,
    });

    expect(result.ok, result.message).toBe(true);
  });

  it("reports the credentials accepted rather than merely reachable", async () => {
    const result = await probeAuthEntra(authConfig(mockEntra), {
      authority: `${origin}/entra`,
    });

    expect(result.message).toContain("credentials accepted");
  });

  it("fails against a tenant the authority does not serve", async () => {
    const result = await probeAuthEntra(authConfig({ ...mockEntra, tenantId: "" }), {
      authority: `${origin}/entra`,
    });

    expect(result.ok).toBe(false);
  });
});

describe("the PKI mock's certificates against the real DN parser", () => {
  const headers = (form: Record<string, string>) =>
    certificateHeadersFor(new URLSearchParams(form)) as Record<string, string | undefined>;

  it("round-trips a surname-first CN through the parser the adapter uses", () => {
    const dn = headers({ email: "ada@example.com", name: "Ada Lovelace", surname_first: "1" })[
      "x-ssl-client-subject-dn"
    ];
    expect(commonNameFrom(dn ?? null)).toBe("Lovelace, Ada");
  });

  it("round-trips an address carried in the subject rather than a SAN", () => {
    const forwarded = headers({ email: "ada@example.com", name: "Ada Lovelace", dn_email: "1" });
    expect(forwarded["x-ssl-client-san-email"]).toBeUndefined();
    expect(emailAddressFrom(forwarded["x-ssl-client-subject-dn"] ?? null)).toBe("ada@example.com");
    expect(commonNameFrom(forwarded["x-ssl-client-subject-dn"] ?? null)).toBe("Ada Lovelace");
  });

  it("round-trips an ordinary certificate unchanged", () => {
    const dn = headers({ email: "ada@example.com", name: "Ada Lovelace" })[
      "x-ssl-client-subject-dn"
    ];
    expect(commonNameFrom(dn ?? null)).toBe("Ada Lovelace");
    expect(emailAddressFrom(dn ?? null)).toBeNull();
  });
});

describe("the Entra mock's tokens through the real claim reader", () => {
  const signIn = async (form: Record<string, string>) => {
    const body = new URLSearchParams({ redirect_uri: "http://localhost:3000/cb", ...form });
    const authorize = await fetch(`${origin}/entra/mock-tenant/oauth2/v2.0/authorize`, {
      method: "POST",
      body,
      redirect: "manual",
    });
    const code = new URL(authorize.headers.get("location") ?? "").searchParams.get("code");
    const token = await fetch(`${origin}/entra/mock-tenant/oauth2/v2.0/token`, {
      method: "POST",
      body: new URLSearchParams({ grant_type: "authorization_code", code: code ?? "" }),
    });
    const payload = (await token.json()) as { id_token: string };
    return userInfoFromIdToken({ idToken: payload.id_token });
  };

  it("marks a stock tenant's identity verified, so organisation assignment can act on it", async () => {
    const info = await signIn({ email: "ada@example.com" });
    expect(info?.user.email).toBe("ada@example.com");
    expect(info?.user.emailVerified).toBe(true);
  });

  it("marks an xms_edov: false identity unverified", async () => {
    const info = await signIn({ email: "ada@example.com", unverified: "1" });
    expect(info?.user.emailVerified).toBe(false);
  });

  it("keeps the opaque subject as the account id", async () => {
    const info = await signIn({ email: "ada@example.com" });
    expect(info?.user.id).toBeTruthy();
    expect(info?.user.id).not.toContain("ada@example.com");
  });
});
