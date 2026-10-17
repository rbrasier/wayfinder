import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  createPublicDataServer,
  gazettePage,
  legislationPage,
  statisticsRelease,
  tendersPage,
  weatherWarnings,
} from "./public-data.mjs";

const connect = async () => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createPublicDataServer({ slowPageDelayMs: 0 }).connect(serverSide);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientSide);
  return client;
};

describe("public-data mock tools", () => {
  it("serves twelve acts over three pages, chained by cursor", () => {
    const first = legislationPage({ query: "", cursor: undefined });
    const second = legislationPage({ query: "", cursor: first.next_cursor });
    const third = legislationPage({ query: "", cursor: second.next_cursor });

    expect([first.items.length, second.items.length, third.items.length]).toEqual([5, 5, 2]);
    expect(third.next_cursor).toBeNull();
    expect(first.status).toBe("ok");
    expect(first.items[0]).toEqual(
      expect.objectContaining({ id: expect.any(String), title: expect.any(String), url: expect.stringMatching(/^https:/), published_at: expect.any(String) }),
    );
  });

  it("filters acts by the query", () => {
    const page = legislationPage({ query: "water", cursor: undefined });
    expect(page.items.every((item) => `${item.title} ${item.summary}`.toLowerCase().includes("water"))).toBe(true);
  });

  it("serves tenders over two pages", () => {
    const first = tendersPage({ cursor: undefined });
    const second = tendersPage({ cursor: first.next_cursor });
    expect(first.items.length + second.items.length).toBe(8);
    expect(second.next_cursor).toBeNull();
  });

  it("reports why an empty result is empty", () => {
    expect(weatherWarnings()).toMatchObject({ status: "source_unavailable", items: [] });
    expect(gazettePage()).toMatchObject({ status: "no_data", items: [], caveats: [expect.any(String)] });
  });

  it("returns resource links and a caveat for the statistics release", () => {
    const result = statisticsRelease();
    expect(result.content.filter((block) => block.type === "resource_link")).toHaveLength(2);
    expect(result.structuredContent.caveats[0]).toMatch(/provisional/i);
  });

  it("lists every public-data tool with a title over MCP", async () => {
    const client = await connect();
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "get_statistics_release",
      "get_weather_warnings",
      "search_gazette",
      "search_legislation",
      "search_tenders",
    ]);
    expect(tools.every((tool) => typeof tool.title === "string")).toBe(true);
  });

  it("returns structured content a client can paginate over MCP", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "search_tenders", arguments: {} });

    expect(result.structuredContent).toMatchObject({ status: "ok", next_cursor: "tenders-2" });
  });
});
