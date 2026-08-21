// Serves the mock HR spreadsheet, mounted at /hr on the shared mocks server.
//
//   GET /hr                 → what this endpoint offers, and the column mapping
//   GET /hr/employees.csv   → the 100-employee roster, ready to upload
//   GET /hr/roster.json     → the same people as json, for debugging
//
// Wayfinder never fetches this: the file goes in through Settings → HR Directory
// Data like any other upload, so the mock exercises the real import path rather
// than a shortcut around it.

import { roster } from "../directory/roster.mjs";
import { CSV_FILENAME, SUGGESTED_COLUMN_MAPPING, renderCsv } from "./dataset.mjs";

const BASE_PATH = "/hr";

const indexPage = () =>
  [
    "Mock HR directory",
    "",
    `  GET ${BASE_PATH}/${CSV_FILENAME}   ${roster.length} employees, five reporting levels`,
    `  GET ${BASE_PATH}/roster.json    the same people as json`,
    "",
    "Upload the csv at /admin/settings → HR Directory Data, then map:",
    ...Object.entries(SUGGESTED_COLUMN_MAPPING).map(
      ([header, field]) => `  ${header} → ${field}`,
    ),
    "",
    "Leave Employee ID, Location and Start Date unmapped — the import keeps them.",
    "",
  ].join("\n");

const send = (res, status, contentType, body, headers = {}) => {
  res.writeHead(status, { "Content-Type": contentType, ...headers });
  res.end(body);
};

const handle = (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const endpoint = url.pathname.slice(BASE_PATH.length).replace(/^\//, "");

  if (req.method !== "GET") {
    send(res, 405, "text/plain", "method not allowed", { Allow: "GET" });
    return;
  }

  if (endpoint === CSV_FILENAME) {
    send(res, 200, "text/csv; charset=utf-8", renderCsv(), {
      "Content-Disposition": `attachment; filename="${CSV_FILENAME}"`,
    });
    return;
  }

  if (endpoint === "roster.json") {
    send(res, 200, "application/json", JSON.stringify(roster));
    return;
  }

  if (endpoint === "") {
    send(res, 200, "text/plain; charset=utf-8", indexPage());
    return;
  }

  send(res, 404, "text/plain", "not found");
};

export const mock = {
  path: BASE_PATH,
  label: "hr (mock HR spreadsheet)",
  handle,
};
