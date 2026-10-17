// Mock public-data MCP server (ADR-062) — sample legislation, tenders, warnings,
// gazette notices and statistics, shaped like the read-only government data
// servers Wayfinder is built to read: structured records with a locator, a title,
// a source link and a timestamp; cursor pagination; a status that says why a
// result is empty; caveats about official status.
//
// Mounted twice on the shared mocks server:
//   /mcp/public-data — stateful Streamable HTTP (session id issued)
//   /mcp/stateless   — stateless Streamable HTTP (no session id, a fresh server
//                      per request)
//
// Register either on the admin MCP servers screen as a "Public-data reader" with
// transport "Streamable HTTP" and a call timeout of at least 30 seconds
// (search_tenders takes 20 s per page). Then, under Tools → Settings:
//
//   search_legislation, search_tenders
//     Pagination   cursor argument: cursor · next-cursor path: next_cursor ·
//                  items path: items · page limit: 5
//     Citations    records path: items · locator: id · title: title · URL: url ·
//                  timestamp: published_at
//   every tool
//     Source status  status path: status · caveats path: caveats · meanings:
//                    no_data = no-data
//                    source_unavailable = source-unavailable
//                    partial = upstream-gap
//
// get_statistics_release cites through MCP resource links, which need no
// settings.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const LEGISLATION_PAGE_SIZE = 5;
const TENDERS_PAGE_SIZE = 4;
// Long enough that the chat's "Calling … · 15s" label and the queued MCP node
// path are visible locally. Overridable so tests run instantly.
const DEFAULT_SLOW_PAGE_DELAY_MS = Number(process.env.MOCK_PUBLIC_DATA_SLOW_MS ?? 20_000);

const ACTS = [
  ["water-management-act-2026", "Water Management Act 2026", "Allocates water entitlements and sets drought restrictions.", "2026-03-14"],
  ["water-quality-amendment-2025", "Water Quality (Amendment) Act 2025", "Raises drinking water testing frequency for regional suppliers.", "2025-11-02"],
  ["procurement-integrity-act-2024", "Procurement Integrity Act 2024", "Requires conflict-of-interest declarations on public tenders.", "2024-07-19"],
  ["fire-services-act-2023", "Fire Services Act 2023", "Establishes bushfire danger ratings and total fire ban powers.", "2023-09-30"],
  ["roads-and-transport-act-2022", "Roads and Transport Act 2022", "Sets heavy vehicle access rules and road maintenance funding.", "2022-05-11"],
  ["public-records-act-2021", "Public Records Act 2021", "Defines retention periods for government records.", "2021-02-08"],
  ["environment-protection-act-2020", "Environment Protection Act 2020", "Introduces the general environmental duty for businesses.", "2020-06-23"],
  ["work-health-safety-act-2019", "Work Health and Safety Act 2019", "Imposes duties on persons conducting a business.", "2019-10-01"],
  ["privacy-and-data-act-2018", "Privacy and Data Act 2018", "Regulates handling of personal information by agencies.", "2018-04-17"],
  ["freedom-of-information-act-2017", "Freedom of Information Act 2017", "Gives the public a right to access government documents.", "2017-08-29"],
  ["planning-and-development-act-2016", "Planning and Development Act 2016", "Sets the framework for development approvals.", "2016-12-05"],
  ["local-government-act-2015", "Local Government Act 2015", "Defines council powers, elections and rating.", "2015-03-20"],
].map(([id, title, summary, published_at]) => ({
  id,
  title,
  summary,
  url: `https://legislation.example.gov/acts/${id}`,
  published_at,
}));

const TENDERS = [
  ["T-2026-0141", "Regional road resurfacing — northern corridor", "2026-10-01", "Open"],
  ["T-2026-0138", "Bushfire monitoring cameras supply and install", "2026-09-28", "Open"],
  ["T-2026-0133", "Water treatment plant maintenance services", "2026-09-22", "Open"],
  ["T-2026-0129", "Records digitisation panel", "2026-09-15", "Closing soon"],
  ["T-2026-0122", "Office fit-out, government hub", "2026-09-04", "Closed"],
  ["T-2026-0117", "Fleet electric vehicle leasing", "2026-08-27", "Closed"],
  ["T-2026-0109", "Community health clinic cleaning", "2026-08-12", "Awarded"],
  ["T-2026-0101", "Flood levee engineering design", "2026-07-30", "Awarded"],
].map(([id, title, published_at, state]) => ({
  id,
  title,
  state,
  url: `https://tenders.example.gov/notices/${id}`,
  published_at,
}));

const UNOFFICIAL_CAVEAT = "Unofficial consolidation — the authorised version is the one published in the Government Gazette.";

const pageOf = (records, pageSize, cursorPrefix, cursor) => {
  const index = cursor ? Number(String(cursor).replace(`${cursorPrefix}-`, "")) - 1 : 0;
  const start = Number.isInteger(index) && index > 0 ? index * pageSize : 0;
  const items = records.slice(start, start + pageSize);
  const hasMore = start + pageSize < records.length;
  return { items, next_cursor: hasMore ? `${cursorPrefix}-${index + 2}` : null };
};

export const legislationPage = ({ query, cursor }) => {
  const needle = (query ?? "").trim().toLowerCase();
  const matching = needle
    ? ACTS.filter((act) => `${act.title} ${act.summary}`.toLowerCase().includes(needle))
    : ACTS;
  return { status: "ok", caveats: [UNOFFICIAL_CAVEAT], ...pageOf(matching, LEGISLATION_PAGE_SIZE, "acts", cursor) };
};

export const tendersPage = ({ cursor }) => ({
  status: "ok",
  caveats: [],
  ...pageOf(TENDERS, TENDERS_PAGE_SIZE, "tenders", cursor),
});

export const weatherWarnings = () => ({
  status: "source_unavailable",
  caveats: ["The warnings feed has not updated since 06:00; absence of warnings does not mean there are none."],
  items: [],
  next_cursor: null,
});

export const gazettePage = () => ({
  status: "no_data",
  caveats: ["The gazette archive before 2010 is not yet digitised."],
  items: [],
  next_cursor: null,
});

export const statisticsRelease = () => {
  const body = {
    status: "ok",
    caveats: ["Figures for the latest quarter are provisional and will be revised."],
    release: "Labour force, September quarter 2026",
    unemployment_rate: 4.1,
  };
  return {
    content: [
      { type: "text", text: JSON.stringify(body) },
      {
        type: "resource_link",
        uri: "https://stats.example.gov/releases/labour-force-2026-q3",
        name: "labour-force-2026-q3",
        title: "Labour force, September quarter 2026",
      },
      {
        type: "resource_link",
        uri: "https://stats.example.gov/methodology/labour-force",
        name: "labour-force-methodology",
        title: "Labour force methodology",
      },
    ],
    structuredContent: body,
  };
};

const structured = (body) => ({ content: [{ type: "text", text: JSON.stringify(body) }], structuredContent: body });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createPublicDataServer({ slowPageDelayMs = DEFAULT_SLOW_PAGE_DELAY_MS } = {}) {
  const mcp = new McpServer({ name: "wayfinder-mock-public-data", version: "0.1.0" });

  mcp.registerTool(
    "search_legislation",
    {
      title: "Search legislation",
      description: "Searches acts by keyword. Five acts per page; pass next_cursor back as cursor for the next page.",
      inputSchema: { query: z.string().optional(), cursor: z.string().optional() },
    },
    (args) => structured(legislationPage(args)),
  );

  mcp.registerTool(
    "search_tenders",
    {
      title: "Search tenders",
      description: "Lists current and recent government tenders. Slow: about 20 seconds per page.",
      inputSchema: { cursor: z.string().optional() },
    },
    async (args) => {
      await sleep(slowPageDelayMs);
      return structured(tendersPage(args));
    },
  );

  mcp.registerTool(
    "get_weather_warnings",
    {
      title: "Weather warnings",
      description: "Current severe weather warnings. The feed is currently down, so it reports itself unavailable.",
      inputSchema: { region: z.string().optional() },
    },
    () => structured(weatherWarnings()),
  );

  mcp.registerTool(
    "search_gazette",
    {
      title: "Search the Government Gazette",
      description: "Searches gazette notices. Returns no data, with a caveat about the archive.",
      inputSchema: { query: z.string().optional() },
    },
    () => structured(gazettePage()),
  );

  mcp.registerTool(
    "get_statistics_release",
    {
      title: "Latest statistics release",
      description: "The latest labour force release, citing its sources as MCP resource links.",
      inputSchema: {},
    },
    () => statisticsRelease(),
  );

  return mcp;
}
