// Mock Gotenberg, mounted at /gotenberg on the shared mocks server.
//
//   GET  /gotenberg/health                        → {"status":"up"}
//   POST /gotenberg/forms/libreoffice/convert     → a fixed one-page PDF
//
// Stands in for the PDF converter sidecar (ADR-067 §3) so the e2e job and local
// dev run without LibreOffice. It does not render the uploaded .docx: the real
// conversion is covered by the adapter's integration job against a real
// Gotenberg. Point Settings → PDF signatures at http://localhost:4001/gotenberg.

import { minimalPdf } from "./minimal-pdf.mjs";

const BASE_PATH = "/gotenberg";

const readBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
};

const send = (res, status, contentType, body) => {
  res.writeHead(status, { "Content-Type": contentType });
  res.end(body);
};

const handle = async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const endpoint = url.pathname.slice(BASE_PATH.length);

  if (req.method === "GET" && endpoint === "/health") {
    send(res, 200, "application/json", JSON.stringify({ status: "up" }));
    return;
  }

  if (req.method === "POST" && endpoint === "/forms/libreoffice/convert") {
    const body = await readBody(req);
    if (body.length === 0) {
      send(res, 400, "text/plain", "no files form field");
      return;
    }
    send(res, 200, "application/pdf", minimalPdf("Converted by the mock Gotenberg"));
    return;
  }

  send(res, 404, "text/plain", "not found");
};

export const mock = { path: BASE_PATH, label: "Gotenberg PDF converter (mock)", handle };
