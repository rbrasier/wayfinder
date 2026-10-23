// A mock of a ParlView-style hearing feed, mounted at /parlview on the shared
// mocks server, for driving the unattended-automation features end to end
// (ADR-063–065). Hearings start and finish on a fixed period (5 minutes by
// default), and each one that finishes can:
//   - fire an Event Watch on "status equals finished" (poll /api/hearings);
//   - call a flow's webhook directly (set one with POST /api/webhook);
//   - be read back by an AI task through the ParlView tools on the mock MCP
//     server (parlview_list_hearings, parlview_get_transcript).
//
//   GET    /parlview                    → what this offers, and ready-made setups
//   GET    /parlview/api/hearings       → { data: { hearings: [...] }, meta: {...} }
//                                          (?status=live|finished|scheduled to filter)
//   GET    /parlview/api/hearings/:id   → { data: hearing-with-transcript }
//   POST   /parlview/api/advance        → skip ahead to the next change now
//   GET    /parlview/api/webhook        → the webhook being called, if any
//   POST   /parlview/api/webhook        → { url, token, hmacSecret? } — call it as hearings finish
//   DELETE /parlview/api/webhook        → stop calling it
//
// PARLVIEW_MOCK_PERIOD_SECONDS changes the period. Any Authorization header is
// accepted, so a watch can be set up with or without a secret.

import { PARLVIEW_PERIOD_MS, parlviewClock } from "./clock.mjs";
import { hearingById, hearingsAt, nextChangeAt } from "./hearings.mjs";
import { createWebhookNotifier, targetFromEnv } from "./webhook.mjs";

const BASE_PATH = "/parlview";

const sendJson = (res, status, body, headers = {}) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(body, null, 2));
};

const readJson = async (req) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return null;
  }
};

const indexPage = (origin, periodMs) =>
  [
    "Mock ParlView hearing feed",
    "",
    `  GET    ${BASE_PATH}/api/hearings        hearings under data.hearings (?status= to filter)`,
    `  GET    ${BASE_PATH}/api/hearings/:id    one hearing with its transcript`,
    `  POST   ${BASE_PATH}/api/advance         skip to the next change now`,
    `  POST   ${BASE_PATH}/api/webhook         { url, token, hmacSecret? } — call a flow as hearings finish`,
    `  DELETE ${BASE_PATH}/api/webhook         stop calling it`,
    "",
    `Every ${Math.round(periodMs / 1000)} seconds the live hearing finishes and the next one goes live.`,
    "",
    "Event Watch (Admin → Event Watch → New watch):",
    `  URL             ${origin}${BASE_PATH}/api/hearings`,
    "  List of items   data.hearings",
    "  Item ID         id",
    "  Condition       status  equals  finished",
    "  Flow inputs     e.g. hearing_id ← id, title ← title, committee ← committee",
    "  Leave Admin → Settings → Automation → watch hosts blank (any host but cloud",
    "  metadata), or add this host — localhost is a private address.",
    "",
    "Webhook start (flow editor → Triggers → Let other systems start this flow):",
    `  curl -X POST ${origin}${BASE_PATH}/api/webhook -H 'Content-Type: application/json' \\`,
    "    -d '{\"url\":\"http://localhost:3000/api/triggers/<flowId>\",\"token\":\"wf_wh_…\"}'",
    "  Add \"hmacSecret\" when the flow requires a signature. Each call sends",
    "  { inputs: { hearing_id, title, committee, portfolio, status, finished_at, topic } };",
    "  declare the ones the flow uses as trigger inputs and the rest are dropped.",
    "",
    "AI task with MCP: register the mock MCP server (http://localhost:4001/mcp) in",
    "Admin → MCP servers, then allow parlview_get_transcript on the step and",
    "pass it {{ input.hearing_id }} in the instruction.",
    "",
  ].join("\n");

export const createParlviewMock = ({
  clock = parlviewClock,
  periodMs = PARLVIEW_PERIOD_MS,
  webhookTarget = targetFromEnv(),
  post = fetch,
  log = console.log,
} = {}) => {
  const notifier = createWebhookNotifier({ target: webhookTarget, periodMs, post, log });
  const tick = () => notifier.check(clock.now());

  const webhook = async (req, res, method) => {
    if (method === "GET") return sendJson(res, 200, { webhook: notifier.describe() });
    if (method === "DELETE") {
      notifier.setTarget(null);
      return sendJson(res, 200, { webhook: null });
    }
    if (method !== "POST") return sendJson(res, 405, { error: "Use GET, POST or DELETE." }, { Allow: "GET, POST, DELETE" });
    const body = await readJson(req);
    if (typeof body?.url !== "string" || typeof body?.token !== "string" || !body.url || !body.token) {
      return sendJson(res, 400, { error: "Send { url, token } and optionally hmacSecret." });
    }
    notifier.setTarget({ url: body.url, token: body.token, hmacSecret: body.hmacSecret || null });
    return sendJson(res, 200, { webhook: notifier.describe() });
  };

  const handle = async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const endpoint = url.pathname.slice(BASE_PATH.length).replace(/^\/|\/$/g, "");
    const method = req.method ?? "GET";

    if (endpoint === "") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(indexPage(url.origin, periodMs));
      return;
    }

    if (endpoint === "api/webhook") return webhook(req, res, method);

    if (endpoint === "api/advance") {
      if (method !== "POST") return sendJson(res, 405, { error: "Use POST." }, { Allow: "POST" });
      const untilNext = Date.parse(nextChangeAt(clock.now(), { periodMs })) - clock.now();
      clock.skip(untilNext);
      await tick();
      return sendJson(res, 200, {
        advancedBySeconds: Math.round(untilNext / 1000),
        now: new Date(clock.now()).toISOString(),
      });
    }

    if (method !== "GET") return sendJson(res, 405, { error: "Use GET." }, { Allow: "GET" });

    if (endpoint === "api/hearings") {
      const status = url.searchParams.get("status");
      const hearings = hearingsAt(clock.now(), { periodMs }).filter((hearing) => !status || hearing.status === status);
      return sendJson(res, 200, {
        data: { hearings },
        meta: {
          generatedAt: new Date(clock.now()).toISOString(),
          periodSeconds: Math.round(periodMs / 1000),
          nextChangeAt: nextChangeAt(clock.now(), { periodMs }),
        },
      });
    }

    const detail = /^api\/hearings\/([^/]+)$/.exec(endpoint);
    if (detail) {
      const hearing = hearingById(decodeURIComponent(detail[1]), clock.now(), { periodMs });
      if (!hearing) return sendJson(res, 404, { error: "No such hearing." });
      return sendJson(res, 200, { data: hearing });
    }

    sendJson(res, 404, { error: "Not found." });
  };

  // `tick` is driven by the server's timer so webhook calls go out on time even
  // when nothing is polling the feed.
  return { path: BASE_PATH, label: "parlview hearing feed (Event Watch / webhook source)", handle, tick };
};

export const mock = createParlviewMock();
