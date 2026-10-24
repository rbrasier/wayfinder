// A mock of parlviewMCP (github.com/AI-CoLab/parlviewMCP), mounted at
// /parlview/mcp on the shared mocks server. It is called exactly as the real one
// is: Streamable HTTP, stateless, with the token as a bearer header or as the
// last path segment (/parlview/mcp/<token>), and the same six tools, arguments
// and JSON answers. Only the recordings are made up: they are the mock feed's,
// on the same clock, so the hearing an Event Watch or webhook started a run for
// is the one these tools read.
//
// The token is PARLVIEW_MOCK_MCP_TOKEN, "mock-parlview-token" by default. As on
// the real server, a call without it gets 401, so a misconfigured MCP server in
// Wayfinder fails here the way it would in production.

import { timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { PARLVIEW_PERIOD_MS, parlviewClock } from "./clock.mjs";
import { createParlviewSource } from "./recordings.mjs";
import {
  deepLinkTool,
  getRecent,
  getTranscript,
  listLiveBroadcasts,
  searchBroadcasts,
  searchCaptions,
} from "./transcript.mjs";

export const MCP_PATH = "/parlview/mcp";
export const DEFAULT_MCP_TOKEN = "mock-parlview-token";

const videoId = z.string().regex(/^\d+$/).describe('ParlView video id, e.g. "4967159" (the `id` from the listing tools)');
const time = z
  .union([z.string(), z.number()])
  .describe('Canberra time of day "HH:MM" or "HH:MM:SS" (how Hansard refers to proceedings), or seconds from recording start');

const READ_ONLY = { readOnlyHint: true, openWorldHint: true, idempotentHint: true };

const wrap = (run) => async (args) => {
  try {
    return { content: [{ type: "text", text: JSON.stringify(run(args)) }] };
  } catch (cause) {
    return { isError: true, content: [{ type: "text", text: `Error: ${cause.message}` }] };
  }
};

// Tool names, titles, descriptions and schemas are parlviewMCP's (src/tools.ts),
// word for word, so a model sees the same tool surface.
export const createParlviewMcpServer = (deps) => {
  const server = new McpServer({ name: "ParlView", version: "1.0.0" });

  server.registerTool(
    "list_live_broadcasts",
    {
      title: "Live ParlView broadcasts",
      description:
        "Australian Parliament broadcasts (committees, chambers, press conferences) live on ParlView right now. " +
        "Returns id, title, committee, group, startedAt and pageUrl. Use the id with get_recent.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    wrap(() => listLiveBroadcasts(deps)),
  );

  server.registerTool(
    "search_broadcasts",
    {
      title: "Search ParlView recordings",
      description:
        "Recent ParlView recordings, newest first, optionally filtered by words in the title " +
        '(e.g. "Environment and Communications", "Senate Chamber", "Estimates"). Returns id, title, committee, ' +
        "isLive, recordedFrom/To, whether it has captions, and its file chunks. Covers roughly the last few weeks.",
      inputSchema: {
        query: z.string().max(200).optional().describe("Words that must all appear in the title/committee/group"),
        limit: z.number().int().min(1).max(40).optional().describe("Default 20"),
      },
      annotations: READ_ONLY,
    },
    wrap((args) => searchBroadcasts(deps, args)),
  );

  server.registerTool(
    "get_transcript",
    {
      title: "Transcript for a time range",
      description:
        "Transcript passages from the official closed captions of a ParlView recording, for a time range. " +
        "Default: last 30 minutes if live, first 30 minutes of speech if archived. At most 2 hours per call; " +
        "when `truncated` is true, call again with from = `nextFrom`. Every passage has its Canberra timecode " +
        "and a link to that moment. stream.status says whether an empty result means no speech, no captions, " +
        "or a source gap. Captions are typed live and contain errors; speakers are not identified.",
      inputSchema: {
        videoId,
        from: time.optional(),
        to: time.optional(),
        maxPassages: z.number().int().min(1).max(1000).optional().describe("Default 300"),
      },
      annotations: READ_ONLY,
    },
    wrap((args) => getTranscript(deps, args)),
  );

  server.registerTool(
    "get_recent",
    {
      title: "Last N minutes of a live broadcast",
      description:
        "Transcript of the last N minutes (default 60) of a LIVE ParlView broadcast, from the official closed " +
        "captions. Use for periodic monitoring. stream.status is explicit: ok, no_speech (nobody talking), " +
        "no_captions_yet, captions_unavailable, api_gap, or not_live (use get_transcript instead). " +
        "stream.lastCaption is the time of the newest line. Captions contain errors; every passage links to " +
        "that moment in the recording.",
      inputSchema: {
        videoId,
        minutes: z.number().int().min(1).max(120).optional().describe("Default 60"),
      },
      annotations: READ_ONLY,
    },
    wrap((args) => getRecent(deps, args)),
  );

  server.registerTool(
    "search_captions",
    {
      title: "Search a recording's captions",
      description:
        "Find where terms were said in a ParlView recording (whole recording by default). Matching is " +
        'case-insensitive and whole-word, tolerant of live-caption spacing: "AirTrunk" also matches "Air Trunk" ' +
        'and "air-trunk"; acronyms like "ANAO" stay whole. Phrases are matched across caption line breaks. ' +
        "Returns each hit's timecode and link, with surrounding passages. Captions misspell names, so try " +
        "variants (surname only, phonetic spellings).",
      inputSchema: {
        videoId,
        terms: z.array(z.string().min(1).max(100)).min(1).max(20).describe("Words or phrases; a hit on any term counts"),
        from: time.optional(),
        to: time.optional(),
        contextPassages: z.number().int().min(0).max(5).optional().describe("Passages either side of a hit; default 1"),
      },
      annotations: READ_ONLY,
    },
    wrap((args) => searchCaptions(deps, args)),
  );

  server.registerTool(
    "deep_link",
    {
      title: "Link to a moment",
      description:
        "ParlView URL that opens a recording at a given moment, given Canberra time of day or seconds from start.",
      inputSchema: { videoId, at: time },
      annotations: READ_ONLY,
    },
    wrap((args) => deepLinkTool(deps, args)),
  );

  return server;
};

// The real server's links go to aph.gov.au; the mock's open its own recording page.
export const mockLinks = (origin) => ({
  pageUrl: (id) => `${origin}/parlview/video/${id}`,
  deepLink: (id, startTime) => `${origin}/parlview/video/${id}?startTime=${Math.max(0, startTime)}`,
});

const sameToken = (given, expected) => {
  const left = Buffer.from(given);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
};

// The token from `Authorization: Bearer …` or from /parlview/mcp/<token>.
export const tokenAccepted = (req, pathname, expected) => {
  const header = req.headers.authorization ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  const pathToken = pathname.startsWith(`${MCP_PATH}/`) ? decodeURIComponent(pathname.slice(MCP_PATH.length + 1)) : "";
  return [bearer, pathToken].some((token) => token && sameToken(token, expected));
};

export const createParlviewMcpMock = ({
  clock = parlviewClock,
  periodMs = PARLVIEW_PERIOD_MS,
  token = process.env.PARLVIEW_MOCK_MCP_TOKEN || DEFAULT_MCP_TOKEN,
} = {}) => {
  const source = createParlviewSource({ clock, periodMs });

  const handle = async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (!tokenAccepted(req, url.pathname, token)) {
      res.writeHead(401, { "Content-Type": "text/plain", "WWW-Authenticate": "Bearer" });
      res.end("Unauthorized");
      return;
    }
    // Stateless, like the real Worker: a fresh server and transport per request.
    const server = createParlviewMcpServer({ source, now: () => clock.now(), links: mockLinks(url.origin) });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  };

  return { path: MCP_PATH, label: "parlview MCP (mock of parlviewMCP)", handle };
};

export const mock = createParlviewMcpMock();
