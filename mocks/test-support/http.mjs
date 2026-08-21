// Minimal stand-ins for Node's request/response, so a mock's `handle` can be
// driven directly in a unit test without binding a port.

import { Readable } from "node:stream";

export const request = (method, url, body = null, headers = {}) => {
  const incoming = Readable.from(body === null ? [] : [Buffer.from(body, "utf8")]);
  incoming.method = method;
  incoming.url = url;
  // Node lowercases incoming header names; a mock that reads them case-sensitively
  // would work in a test and fail against a real client.
  incoming.headers = { host: "localhost:4001" };
  for (const [name, value] of Object.entries(headers)) {
    incoming.headers[name.toLowerCase()] = value;
  }
  return incoming;
};

export const response = () => {
  const recorded = { statusCode: null, headers: {}, body: "", headersSent: false };
  return {
    recorded,
    get headersSent() {
      return recorded.headersSent;
    },
    writeHead(statusCode, headers = {}) {
      recorded.statusCode = statusCode;
      recorded.headers = headers;
      recorded.headersSent = true;
    },
    end(chunk = "") {
      recorded.body += chunk;
    },
  };
};

export const json = (recorded) => JSON.parse(recorded.body);

// A faithful, dependency-free model of the one HTML parser rule that bites a
// server-rendered picker: "a start tag whose tag name is form — if the form
// element pointer is not null, ignore the token" (HTML5 §13.2.6.4.7). An
// unclosed <form> therefore does not just render oddly, it *swallows* every
// later form on the page, so a submit button lands in the wrong form and posts
// the wrong hidden fields. Asserting on markup substrings cannot see that.
export const formStructure = (html) => {
  const tags = [...html.matchAll(/<(\/?)form\b/g)];
  const swallowed = [];
  let open = false;
  let opened = 0;
  for (const tag of tags) {
    const isClosing = tag[1] === "/";
    if (isClosing) {
      open = false;
      continue;
    }
    if (open) swallowed.push(tag.index);
    else opened += 1;
    open = true;
  }
  return { opened, swallowed, unclosed: open };
};

// The markup a browser would treat as belonging to the form that owns `testId`.
export const formOwning = (html, testId) => {
  const anchor = html.indexOf(`data-testid="${testId}"`);
  if (anchor === -1) return null;
  const start = html.lastIndexOf("<form", anchor);
  if (start === -1) return null;
  const end = html.indexOf("</form>", anchor);
  return html.slice(start, end === -1 ? html.length : end);
};
