// Minimal stand-ins for Node's request/response, so a mock's `handle` can be
// driven directly in a unit test without binding a port.

import { Readable } from "node:stream";

export const request = (method, url, body = null) => {
  const incoming = Readable.from(body === null ? [] : [Buffer.from(body, "utf8")]);
  incoming.method = method;
  incoming.url = url;
  incoming.headers = { host: "localhost:4001" };
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
