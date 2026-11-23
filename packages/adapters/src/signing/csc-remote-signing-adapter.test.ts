import { describe, expect, it } from "vitest";
import type { CscProviderConfig } from "@wayfinder/domain";
import { CscRemoteSigningAdapter } from "./csc-remote-signing-adapter";

const config: CscProviderConfig = {
  baseUrl: "http://csc.test/csc/v2/",
  clientId: "wayfinder",
  clientSecret: "secret",
};

interface Call {
  url: string;
  init?: RequestInit;
}

const fakeFetch = (routes: Record<string, () => Response>) => {
  const calls: Call[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const route = routes[url];
    if (!route) return new Response("not found", { status: 404 });
    return route();
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
};

const info = () => Response.json({ specs: "2.0.0.2", oauth2: "http://csc.test/csc" });

describe("CscRemoteSigningAdapter", () => {
  it("builds the service authorisation URL from the provider's OAuth base", async () => {
    const { fetchFn } = fakeFetch({ "http://csc.test/csc/v2/info": info });

    const result = await new CscRemoteSigningAdapter(fetchFn).authorizationUrl(config, {
      scope: "service",
      redirectUri: "http://app/cb",
      state: "s1",
    });

    const url = new URL(result.data!);
    expect(url.origin + url.pathname).toBe("http://csc.test/csc/oauth2/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "wayfinder",
      redirect_uri: "http://app/cb",
      scope: "service",
      state: "s1",
    });
  });

  it("names the credential and the base64url hash on a credential authorisation", async () => {
    const { fetchFn } = fakeFetch({ "http://csc.test/csc/v2/info": info });
    const hash = Buffer.alloc(32, 0xfb).toString("base64");

    const result = await new CscRemoteSigningAdapter(fetchFn).authorizationUrl(config, {
      scope: "credential",
      redirectUri: "http://app/cb",
      state: "s2",
      credentialId: "valid",
      hash,
    });

    const params = new URL(result.data!).searchParams;
    expect(params.get("credentialID")).toBe("valid");
    expect(params.get("numSignatures")).toBe("1");
    expect(params.get("hashes")).toBe(Buffer.alloc(32, 0xfb).toString("base64url"));
    expect(params.get("hashAlgorithmOID")).toBe("2.16.840.1.101.3.4.2.1");
  });

  it("exchanges a code for an access token with the client credentials", async () => {
    const { fetchFn, calls } = fakeFetch({
      "http://csc.test/csc/v2/info": info,
      "http://csc.test/csc/oauth2/token": () => Response.json({ access_token: "tok", token_type: "Bearer" }),
    });

    const result = await new CscRemoteSigningAdapter(fetchFn).exchangeCode(config, "code-1", "http://app/cb");

    expect(result.data).toBe("tok");
    const form = new URLSearchParams(String(calls[1]!.init!.body));
    expect(Object.fromEntries(form)).toMatchObject({
      grant_type: "authorization_code",
      code: "code-1",
      client_id: "wayfinder",
      client_secret: "secret",
    });
  });

  it("lists the credential, reads its chain and signs a hash with the bearer token", async () => {
    const { fetchFn, calls } = fakeFetch({
      "http://csc.test/csc/v2/credentials/list": () => Response.json({ credentialIDs: ["valid"] }),
      "http://csc.test/csc/v2/credentials/info": () => Response.json({ cert: { certificates: ["Y2VydA=="] } }),
      "http://csc.test/csc/v2/signatures/signHash": () => Response.json({ signatures: ["c2ln"] }),
    });
    const adapter = new CscRemoteSigningAdapter(fetchFn);

    expect((await adapter.firstCredential(config, "tok")).data).toBe("valid");
    expect((await adapter.certificateChain(config, "tok", "valid")).data).toEqual(["Y2VydA=="]);
    expect((await adapter.signHash(config, "tok", "valid", "aGFzaA==")).data).toBe("c2ln");
    expect((calls[2]!.init!.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(String(calls[2]!.init!.body))).toEqual({
      credentialID: "valid",
      hashes: ["aGFzaA=="],
      hashAlgorithmOID: "2.16.840.1.101.3.4.2.1",
      signAlgo: "1.2.840.113549.1.1.11",
    });
  });

  it("reports the provider's own error description", async () => {
    const { fetchFn } = fakeFetch({
      "http://csc.test/csc/v2/signatures/signHash": () =>
        Response.json({ error: "invalid_request", error_description: "Hashes not authorised" }, { status: 403 }),
    });

    const result = await new CscRemoteSigningAdapter(fetchFn).signHash(config, "tok", "valid", "aGFzaA==");

    expect(result.error?.code).toBe("INFRA_FAILURE");
    expect(result.error?.message).toBe("The signing provider refused: Hashes not authorised");
  });

  it("fails as unreachable when the provider cannot be contacted", async () => {
    const fetchFn = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    const result = await new CscRemoteSigningAdapter(fetchFn).firstCredential(config, "tok");

    expect(result.error?.message).toBe("The signing provider is unreachable.");
  });

  it("refuses a provider with no credential for the signer", async () => {
    const { fetchFn } = fakeFetch({
      "http://csc.test/csc/v2/credentials/list": () => Response.json({ credentialIDs: [] }),
    });

    const result = await new CscRemoteSigningAdapter(fetchFn).firstCredential(config, "tok");

    expect(result.error?.message).toBe("The signing provider has no digital ID for this signer.");
  });
});
