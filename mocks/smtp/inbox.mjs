// Where the mock SMTP server puts what it catches: printed to the console as it
// arrives, and kept (most recent first) for the /smtp endpoint on the shared
// mocks server, so a test or a person can read back exactly what was sent.
//
//   GET    /smtp                  → how to point Wayfinder at the mock
//   GET    /smtp/messages         → caught messages, newest first, without raw source
//   GET    /smtp/messages/:id     → one message in full, raw source included
//   DELETE /smtp/messages         → empty the inbox

import { formatForConsole, parseMessage } from "./message.mjs";

const BASE_PATH = "/smtp";
const DEFAULT_LIMIT = 100;

export const SMTP_PORT = Number(process.env.MOCKS_SMTP_PORT ?? 2525);

export const createInbox = ({ log = console.log, limit = DEFAULT_LIMIT } = {}) => {
  let messages = [];
  let nextId = 1;

  const add = ({ envelopeFrom, envelopeTo, raw }) => {
    const message = {
      id: nextId,
      receivedAt: new Date().toISOString(),
      envelopeFrom,
      envelopeTo,
      ...parseMessage(raw),
      raw,
    };
    nextId += 1;
    messages = [message, ...messages].slice(0, limit);
    log(formatForConsole(message));
    return message;
  };

  return {
    add,
    list: () => messages,
    find: (id) => messages.find((message) => message.id === id) ?? null,
    clear: () => {
      messages = [];
    },
  };
};

const sendJson = (res, status, body, headers = {}) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(body, null, 2));
};

const indexPage = () =>
  [
    "Mock SMTP server (catches mail, delivers none)",
    "",
    `  SMTP on port ${SMTP_PORT}. Any username and password are accepted; no TLS.`,
    "  Every message is printed to the mocks console and kept here:",
    `  GET    ${BASE_PATH}/messages        newest first`,
    `  GET    ${BASE_PATH}/messages/:id    one in full, with its raw source`,
    `  DELETE ${BASE_PATH}/messages        empty the inbox`,
    "",
    "Point Wayfinder at it in Admin → Settings → Email (SMTP):",
    "  Host localhost, port " + SMTP_PORT + ", TLS off, username mock, password mock,",
    "  from address e.g. wayfinder@example.com.",
    "Or in .env: SMTP_TRANSPORT_MODE=smtp, SMTP_HOST=localhost, SMTP_PORT=" + SMTP_PORT + ",",
    "  SMTP_USER=mock, SMTP_PASS=mock — this overrides the admin settings.",
    "Notification emails also need NOTIFICATIONS_ENABLED=true; the Email step does not.",
    "",
  ].join("\n");

const summary = ({ raw: _raw, ...message }) => message;

export const createInboxMock = (inbox) => ({
  path: BASE_PATH,
  label: `smtp inbox (mail caught on port ${SMTP_PORT})`,
  handle: (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const endpoint = url.pathname.slice(BASE_PATH.length).replace(/^\/|\/$/g, "");
    const method = req.method ?? "GET";

    if (endpoint === "") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(indexPage());
      return;
    }

    if (endpoint === "messages") {
      if (method === "DELETE") {
        inbox.clear();
        return sendJson(res, 200, { cleared: true });
      }
      if (method !== "GET") return sendJson(res, 405, { error: "Use GET or DELETE." }, { Allow: "GET, DELETE" });
      return sendJson(res, 200, { messages: inbox.list().map(summary) });
    }

    const single = /^messages\/(\d+)$/.exec(endpoint);
    if (single && method === "GET") {
      const message = inbox.find(Number(single[1]));
      return message ? sendJson(res, 200, message) : sendJson(res, 404, { error: "No such message." });
    }

    sendJson(res, 404, { error: "Not found." });
  },
});
