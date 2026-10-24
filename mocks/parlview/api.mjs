// A mock of ParlView, mounted at /parlview on the shared mocks server, for
// driving the unattended-automation features end to end (ADR-063–065). It
// answers ParlView's own endpoints in ParlView's own shapes (the ones
// parlviewMCP reads), over recordings that start and finish on a fixed period
// (5 minutes by default). Each recording that finishes can:
//   - fire an Event Watch on vodapi's `isLive` going from true to false;
//   - call a flow's webhook directly (set one with POST /api/webhook);
//   - be read back by an AI task through the mock ParlView MCP (mcp.mjs).
//
// As ParlView answers (paths after /parlview):
//   GET    /vodapi/api/search                       { searchResults: { totalItems, videos } }
//   GET    /vodapi/api/search/:id                   { videoDetails }
//   GET    /vod/api/videos/eventvideos/:id          the recording's chunks
//   POST   /vod/api/videos/captions/:id             { fromOffset, toOffset, timecodeFormat } → caption lines
// The mock's own controls:
//   GET    /                                        the landing page: what is live, buttons, setups
//   GET    /video/:id?startTime=                    a recording's captions (where MCP deep links go)
//   POST   /api/advance                             skip ahead to the next change now
//   GET    /api/webhook                             the webhook being called, if any
//   POST   /api/webhook                             { url, token, hmacSecret? } — call it as hearings finish
//   DELETE /api/webhook                             stop calling it
// The landing page's buttons post HTML forms to the same two control endpoints,
// which then send the browser back to the page.
//
// PARLVIEW_MOCK_PERIOD_SECONDS changes the period. Any Authorization header is
// accepted on the feed, so a watch can be set up with or without a secret.

import { PARLVIEW_PERIOD_MS, parlviewClock } from "./clock.mjs";
import { DEFAULT_MCP_TOKEN, MCP_PATH } from "./mcp.mjs";
import {
  FPS,
  captionScript,
  captionsBetween,
  eventVideos,
  listedRecordings,
  nextChangeAt,
  recordingById,
  searchResults,
  timecodeOf,
  vodapiVideo,
} from "./recordings.mjs";
import { createWebhookNotifier, targetFromEnv } from "./webhook.mjs";

const BASE_PATH = "/parlview";
const FORM_TYPE = "application/x-www-form-urlencoded";

const sendJson = (res, status, body, headers = {}) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(body, null, 2));
};

const sendHtml = (res, html) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
};

const backToLanding = (res, notice) => {
  res.writeHead(303, { Location: `${BASE_PATH}?notice=${encodeURIComponent(notice)}` });
  res.end();
};

const readBody = async (req) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw;
};

const isForm = (req) => (req.headers["content-type"] ?? "").startsWith(FORM_TYPE);

const readJson = async (req) => {
  try {
    return JSON.parse((await readBody(req)) || "{}");
  } catch {
    return null;
  }
};

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);

const clockText = (iso) => (iso ? iso.slice(11, 19) : "now");

// ---------------------------------------------------------------------------
// Pages

const PAGE_STYLE = `
  body { font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; margin: 24px auto; max-width: 960px; padding: 0 16px; color: #1a1a1a; background: #fff; }
  h1 { font-size: 16px; margin: 0 0 4px; } h2 { font-size: 14px; margin: 28px 0 8px; }
  a { color: #0645ad; } p { margin: 4px 0; } .muted { color: #666; }
  .notice { background: #eef6ee; border: 1px solid #b7d8b7; padding: 6px 10px; margin: 12px 0; }
  .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 12px 0; }
  button, input { font: inherit; } button { padding: 4px 12px; cursor: pointer; }
  input { padding: 3px 6px; width: 260px; max-width: 100%; } code { overflow-wrap: anywhere; }
  .scroll { overflow-x: auto; } table { border-collapse: collapse; width: 100%; } .nowrap { white-space: nowrap; } table.captions { width: auto; } td, th { text-align: left; padding: 3px 12px 3px 0; vertical-align: top; }
  th { font-weight: normal; color: #666; } .live { color: #b00020; }
  pre { background: #f6f6f6; padding: 8px 10px; overflow-x: auto; margin: 4px 0; max-width: 100%; }
  p { overflow-wrap: anywhere; }
  .moment { background: #fff3b0; }
  @media (prefers-color-scheme: dark) {
    body { color: #ddd; background: #161616; } a { color: #8ab4f8; } .muted, th { color: #999; }
    pre { background: #222; } .notice { background: #1e2b1e; border-color: #345234; } .moment { background: #4a4214; } .live { color: #ff6b81; }
  }`;

const page = (title, body) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
  `<title>${escapeHtml(title)}</title><style>${PAGE_STYLE}</style></head><body>${body}</body></html>`;

const recordingRows = (videos) =>
  videos
    .map((video) => {
      const id = escapeHtml(video.parlViewId);
      const status = video.isLive ? `<span class="live">● live</span>` : "finished";
      return (
        `<tr><td><a href="${BASE_PATH}/video/${id}">${id}</a></td><td>${status}</td>` +
        `<td class="nowrap">${clockText(video.recordingFrom)}–${clockText(video.recordingTo)}</td>` +
        `<td>${escapeHtml(video.eventTitle)}</td>` +
        `<td><a href="${BASE_PATH}/vodapi/api/search/${id}">details</a> · ` +
        `<a href="${BASE_PATH}/vod/api/videos/eventvideos/${id}">eventvideos</a></td></tr>`
      );
    })
    .join("");

const webhookSection = (webhook) => {
  const current = webhook
    ? `<p>Calling <code>${escapeHtml(webhook.url)}</code>${webhook.signsWithHmac ? ", signed with HMAC" : ""} as each hearing finishes.</p>` +
      `<form method="post" action="${BASE_PATH}/api/webhook" class="row"><input type="hidden" name="stop" value="1">` +
      `<button type="submit">Stop calling it</button></form>`
    : `<p class="muted">Not calling any webhook.</p>`;
  return (
    `<h2>Webhook start</h2>${current}` +
    `<p class="muted">Flow editor → Triggers → Let other systems start this flow, then paste its URL and token here.</p>` +
    `<form method="post" action="${BASE_PATH}/api/webhook" class="row">` +
    `<input name="url" placeholder="http://localhost:3000/api/triggers/&lt;flowId&gt;" required aria-label="Webhook URL">` +
    `<input name="token" placeholder="wf_wh_…" required aria-label="Bearer token">` +
    `<input name="hmacSecret" placeholder="HMAC secret (optional)" aria-label="HMAC secret">` +
    `<button type="submit">Call it as hearings finish</button></form>` +
    `<p class="muted">Each call sends <code>{ inputs: { hearing_id, title, committee, status, recorded_from, recorded_to } }</code>; ` +
    `declare the ones the flow uses as trigger inputs and the rest are dropped.</p>`
  );
};

const landingPage = ({ origin, nowMs, periodMs, webhook, notice, mcpToken }) => {
  const videos = listedRecordings(nowMs, { periodMs }).map(vodapiVideo);
  const live = videos.find((video) => video.isLive);
  const latestFinished = videos.find((video) => !video.isLive);
  const nextChange = nextChangeAt(nowMs, { periodMs });
  const secondsLeft = Math.max(0, Math.ceil((Date.parse(nextChange) - nowMs) / 1000));
  const mcpUrl = `${origin}${MCP_PATH}`;
  const tokenNote = mcpToken === DEFAULT_MCP_TOKEN ? " (PARLVIEW_MOCK_MCP_TOKEN to change)" : "";

  return page(
    "Mock ParlView",
    `<h1>Mock ParlView</h1>` +
      `<p class="muted">ParlView's endpoints and a parlviewMCP-compatible MCP server, over made-up Senate hearings. ` +
      `Every ${Math.round(periodMs / 1000)} seconds the live hearing finishes and the next one goes live.</p>` +
      (notice ? `<p class="notice" role="status">${escapeHtml(notice)}</p>` : "") +
      `<p>Live now: <a href="${BASE_PATH}/video/${escapeHtml(live.parlViewId)}">${escapeHtml(live.parlViewId)}</a> ${escapeHtml(live.eventTitle)}</p>` +
      `<p>Next change in <span id="countdown" data-seconds="${secondsLeft}">${secondsLeft}s</span> (it finishes and ${escapeHtml(String(Number(live.parlViewId) + 1))} goes live).</p>` +
      `<div class="row">` +
      `<form method="post" action="${BASE_PATH}/api/advance"><button type="submit" autofocus>Advance to next change</button></form>` +
      `<a href="${BASE_PATH}">Refresh</a>` +
      (latestFinished
        ? ` · <a href="${BASE_PATH}/video/${escapeHtml(latestFinished.parlViewId)}">Last finished hearing's captions</a>`
        : "") +
      `</div>` +
      `<h2>Recordings (as vodapi lists them)</h2>` +
      `<div class="scroll"><table><thead><tr><th>id</th><th>status</th><th>Canberra</th><th>committee</th><th>raw</th></tr></thead>` +
      `<tbody>${recordingRows(videos)}</tbody></table></div>` +
      `<h2>ParlView endpoints</h2>` +
      `<p><a href="${BASE_PATH}/vodapi/api/search?pageSize=40&amp;page=0">GET /vodapi/api/search</a> — the listing an Event Watch polls</p>` +
      `<p><a href="${BASE_PATH}/vodapi/api/search/${escapeHtml(live.parlViewId)}">GET /vodapi/api/search/:id</a> · ` +
      `<a href="${BASE_PATH}/vod/api/videos/eventvideos/${escapeHtml(live.parlViewId)}">GET /vod/api/videos/eventvideos/:id</a></p>` +
      `<p>POST /vod/api/videos/captions/:id <span class="muted">{ "fromOffset": 0, "toOffset": 0, "timecodeFormat": "Pal" } — ms from FileSom, 0 = open-ended</span></p>` +
      `<h2>Event Watch</h2>` +
      `<p class="muted">Admin → Event Watch → New watch, then Test to load the sample.</p>` +
      `<pre>URL             ${escapeHtml(origin)}${BASE_PATH}/vodapi/api/search?pageSize=40&amp;page=0\n` +
      `List of items   searchResults.videos\nItem ID         parlViewId\n` +
      `Condition       A field changes to a value: isLive, from true, to false\n` +
      `Flow inputs     e.g. hearing_id ← parlViewId, title ← parlViewTitle, committee ← eventTitle</pre>` +
      `<p class="muted">Leave Admin → Settings → Automation → watch hosts blank, or add this host (localhost is a private address).</p>` +
      webhookSection(webhook) +
      `<h2>ParlView MCP</h2>` +
      `<p class="muted">The same six tools as parlviewMCP, over these hearings. Admin → MCP servers → Register:</p>` +
      `<pre>Label       ParlView\nTransport   Streamable HTTP\nURL         ${escapeHtml(mcpUrl)}/${escapeHtml(mcpToken)}\n\n` +
      `Or, with the token as a bearer header as in production:\n` +
      `URL         ${escapeHtml(mcpUrl)}\nCredential  an env var on the web app holding ${escapeHtml(mcpToken)}${escapeHtml(tokenNote)}</pre>` +
      `<p class="muted">list_live_broadcasts · search_broadcasts · get_transcript · get_recent · search_captions · deep_link. ` +
      `In an AI task, allow get_transcript and pass it <code>{{ input.hearing_id }}</code> as videoId.</p>` +
      `<script>(() => { const el = document.getElementById("countdown"); let left = Number(el.dataset.seconds);` +
      ` const tick = () => { el.textContent = Math.max(0, left) + "s"; if (left < 0) { location.replace("${BASE_PATH}"); return; } left -= 1; setTimeout(tick, 1000); };` +
      ` tick(); })();</script>`,
  );
};

const videoPage = ({ recording, nowMs, startTime }) => {
  const video = vodapiVideo(recording);
  const momentFrame = startTime === null ? null : recording.startFrame + startTime * FPS;
  const spokenBy = recording.status === "live" ? recording.startFrame + ((nowMs - recording.startMs) / 1000) * FPS : Infinity;
  const lines = captionScript(recording).filter((line) => line.outFrame <= spokenBy);
  const momentIndex =
    momentFrame === null ? -1 : lines.findLastIndex((line) => line.inFrame <= momentFrame);
  const rows = lines
    .map((line, index) => {
      const offset = Math.floor((line.inFrame - recording.startFrame) / FPS);
      const highlight = index === momentIndex ? ` class="moment" id="moment"` : "";
      return `<tr${highlight}><td><a href="?startTime=${offset}">${timecodeOf(line.inFrame).slice(0, 8)}</a></td><td>${escapeHtml(line.text)}</td></tr>`;
    })
    .join("");
  return page(
    `${video.parlViewId} — Mock ParlView`,
    `<p><a href="${BASE_PATH}">← Mock ParlView</a></p>` +
      `<h1>${escapeHtml(video.parlViewTitle)}</h1>` +
      `<p class="muted">${escapeHtml(video.parlViewId)} · ${video.isLive ? `<span class="live">● live</span>` : "finished"} · ` +
      `${clockText(video.recordingFrom)}–${clockText(video.recordingTo)} Canberra time · captions as typed live, no speakers</p>` +
      (rows ? `<table class="captions">${rows}</table>` : `<p class="muted">No captions yet.</p>`) +
      (momentIndex >= 0 ? `<script>document.getElementById("moment").scrollIntoView({ block: "center" });</script>` : ""),
  );
};

// ---------------------------------------------------------------------------
// Handler

export const createParlviewMock = ({
  clock = parlviewClock,
  periodMs = PARLVIEW_PERIOD_MS,
  webhookTarget = targetFromEnv(),
  post = fetch,
  log = console.log,
  mcpToken = process.env.PARLVIEW_MOCK_MCP_TOKEN || DEFAULT_MCP_TOKEN,
} = {}) => {
  const notifier = createWebhookNotifier({ target: webhookTarget, periodMs, post, log });
  const tick = () => notifier.check(clock.now());
  const recording = (id) => recordingById(decodeURIComponent(id), clock.now(), { periodMs });

  const advance = async (req, res, method) => {
    if (method !== "POST") return sendJson(res, 405, { error: "Use POST." }, { Allow: "POST" });
    const finishing = listedRecordings(clock.now(), { periodMs })[0];
    const untilNext = Date.parse(nextChangeAt(clock.now(), { periodMs })) - clock.now();
    clock.skip(untilNext);
    await tick();
    const advancedBySeconds = Math.round(untilNext / 1000);
    if (isForm(req)) {
      return backToLanding(res, `Skipped ${advancedBySeconds}s: ${finishing.id} finished and ${Number(finishing.id) + 1} is live.`);
    }
    return sendJson(res, 200, { advancedBySeconds, now: new Date(clock.now()).toISOString() });
  };

  const webhookFromForm = async (req, res) => {
    const form = new URLSearchParams(await readBody(req));
    if (form.get("stop")) {
      notifier.setTarget(null);
      return backToLanding(res, "Stopped calling the webhook.");
    }
    const url = form.get("url")?.trim();
    const token = form.get("token")?.trim();
    if (!url || !token) return backToLanding(res, "Enter the webhook's URL and token.");
    notifier.setTarget({ url, token, hmacSecret: form.get("hmacSecret")?.trim() || null });
    return backToLanding(res, `Calling ${url} as each hearing finishes.`);
  };

  const webhook = async (req, res, method) => {
    if (method === "GET") return sendJson(res, 200, { webhook: notifier.describe() });
    if (method === "DELETE") {
      notifier.setTarget(null);
      return sendJson(res, 200, { webhook: null });
    }
    if (method !== "POST") return sendJson(res, 405, { error: "Use GET, POST or DELETE." }, { Allow: "GET, POST, DELETE" });
    if (isForm(req)) return webhookFromForm(req, res);
    const body = await readJson(req);
    if (typeof body?.url !== "string" || typeof body?.token !== "string" || !body.url || !body.token) {
      return sendJson(res, 400, { error: "Send { url, token } and optionally hmacSecret." });
    }
    notifier.setTarget({ url: body.url, token: body.token, hmacSecret: body.hmacSecret || null });
    return sendJson(res, 200, { webhook: notifier.describe() });
  };

  const captions = async (req, res, id) => {
    const body = await readJson(req);
    if (body === null) return sendJson(res, 400, { error: "Send JSON { fromOffset, toOffset, timecodeFormat }." });
    const offsets = { fromOffset: Number(body.fromOffset) || 0, toOffset: Number(body.toOffset) || 0 };
    return sendJson(res, 200, captionsBetween(recording(id), clock.now(), offsets));
  };

  const parlviewEndpoint = async (req, res, method, endpoint) => {
    const captionsMatch = /^vod\/api\/videos\/captions\/([^/]+)$/.exec(endpoint);
    if (captionsMatch) {
      if (method !== "POST") return sendJson(res, 405, { error: "Use POST." }, { Allow: "POST" });
      return captions(req, res, captionsMatch[1]);
    }
    if (method !== "GET") return sendJson(res, 405, { error: "Use GET." }, { Allow: "GET" });

    if (endpoint === "vodapi/api/search") {
      const url = new URL(req.url ?? "/", "http://localhost");
      const page = Number(url.searchParams.get("page")) || 0;
      const pageSize = Number(url.searchParams.get("pageSize")) || 40;
      // vodapi ignores searchTerm, so the mock does too.
      return sendJson(res, 200, searchResults(clock.now(), { periodMs, page, pageSize }));
    }
    const detailsMatch = /^vodapi\/api\/search\/([^/]+)$/.exec(endpoint);
    if (detailsMatch) {
      const found = recording(detailsMatch[1]);
      if (!found || found.status === "scheduled") return sendJson(res, 404, { error: "Not found." });
      return sendJson(res, 200, { videoDetails: vodapiVideo(found) });
    }
    const chunksMatch = /^vod\/api\/videos\/eventvideos\/([^/]+)$/.exec(endpoint);
    if (chunksMatch) return sendJson(res, 200, eventVideos(recording(chunksMatch[1]), clock.now()));
    return sendJson(res, 404, { error: "Not found." });
  };

  const handle = async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const endpoint = url.pathname.slice(BASE_PATH.length).replace(/^\/|\/$/g, "");
    const method = req.method ?? "GET";

    if (endpoint === "" && method === "GET") {
      return sendHtml(
        res,
        landingPage({
          origin: url.origin,
          nowMs: clock.now(),
          periodMs,
          webhook: notifier.describe(),
          notice: url.searchParams.get("notice"),
          mcpToken,
        }),
      );
    }
    if (endpoint === "api/webhook") return webhook(req, res, method);
    if (endpoint === "api/advance") return advance(req, res, method);

    const videoMatch = /^video\/([^/]+)$/.exec(endpoint);
    if (videoMatch && method === "GET") {
      const found = recording(videoMatch[1]);
      if (!found || found.status === "scheduled") return sendJson(res, 404, { error: "No such recording." });
      const startTime = url.searchParams.has("startTime") ? Number(url.searchParams.get("startTime")) || 0 : null;
      return sendHtml(res, videoPage({ recording: found, nowMs: clock.now(), startTime }));
    }

    if (endpoint.startsWith("vodapi/") || endpoint.startsWith("vod/")) return parlviewEndpoint(req, res, method, endpoint);
    sendJson(res, 404, { error: "Not found." });
  };

  // `tick` is driven by the server's timer so webhook calls go out on time even
  // when nothing is polling the feed.
  return { path: BASE_PATH, label: "parlview (vodapi, vod captions; Event Watch / webhook source)", handle, tick };
};

export const mock = createParlviewMock();
