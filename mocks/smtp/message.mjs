// Just enough MIME to show a caught email in the console: the headers people
// read, the text and HTML bodies, and the attachments by name. Handles what
// nodemailer sends — nested multipart, base64 and quoted-printable, and
// encoded-word subjects — rather than every corner of the spec.

const splitHead = (raw) => {
  const normalised = raw.replace(/\r\n/g, "\n");
  const blank = normalised.indexOf("\n\n");
  if (blank === -1) return { head: normalised, body: "" };
  return { head: normalised.slice(0, blank), body: normalised.slice(blank + 2) };
};

const parseHeaders = (head) => {
  const headers = {};
  // A line starting with whitespace continues the header above it.
  const unfolded = head.replace(/\n[ \t]+/g, " ");
  for (const line of unfolded.split("\n")) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  return headers;
};

const headerParameter = (value, name) => {
  const match = new RegExp(`${name}\\*?=(?:"([^"]*)"|([^;\\s]*))`, "i").exec(value ?? "");
  return match ? (match[1] ?? match[2]) : null;
};

const decodeQuotedPrintable = (text) => {
  const bytes = [];
  const joined = text.replace(/=\n/g, "");
  for (let index = 0; index < joined.length; index += 1) {
    const hex = joined.slice(index + 1, index + 3);
    if (joined[index] === "=" && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(Number.parseInt(hex, 16));
      index += 2;
      continue;
    }
    bytes.push(...Buffer.from(joined[index], "utf8"));
  }
  return Buffer.from(bytes);
};

const decodeBody = (body, encoding) => {
  const kind = (encoding ?? "").toLowerCase();
  if (kind === "base64") return Buffer.from(body.replace(/\s+/g, ""), "base64");
  if (kind === "quoted-printable") return decodeQuotedPrintable(body);
  return Buffer.from(body, "utf8");
};

const decodeEncodedWords = (value) =>
  (value ?? "").replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_match, _charset, kind, text) =>
    kind.toUpperCase() === "B"
      ? Buffer.from(text, "base64").toString("utf8")
      : decodeQuotedPrintable(text.replace(/_/g, " ")).toString("utf8"),
  );

const collectParts = (raw, found) => {
  const { head, body } = splitHead(raw);
  const headers = parseHeaders(head);
  const contentType = headers["content-type"] ?? "text/plain";
  const boundary = headerParameter(contentType, "boundary");

  if (/^multipart\//i.test(contentType) && boundary) {
    const sections = body.split(`--${boundary}`);
    // The first section is the preamble and the last follows the closing "--".
    for (const section of sections.slice(1)) {
      if (section.startsWith("--")) break;
      collectParts(section.replace(/^\n/, "").replace(/\n$/, ""), found);
    }
    return;
  }

  const content = decodeBody(body, headers["content-transfer-encoding"]);
  const disposition = headers["content-disposition"] ?? "";
  const filename = headerParameter(disposition, "filename") ?? headerParameter(contentType, "name");
  if (/^attachment/i.test(disposition) || filename) {
    found.attachments.push({
      filename: decodeEncodedWords(filename ?? "unnamed"),
      contentType: contentType.split(";")[0].trim(),
      bytes: content.length,
    });
    return;
  }
  if (/^text\/html/i.test(contentType)) found.html ??= content.toString("utf8").trim();
  else if (/^text\//i.test(contentType)) found.text ??= content.toString("utf8").trim();
};

export const parseMessage = (raw) => {
  const headers = parseHeaders(splitHead(raw).head);
  const found = { text: null, html: null, attachments: [] };
  collectParts(raw, found);
  return {
    from: decodeEncodedWords(headers.from) || null,
    to: decodeEncodedWords(headers.to) || null,
    cc: decodeEncodedWords(headers.cc) || null,
    subject: decodeEncodedWords(headers.subject),
    text: found.text,
    html: found.html,
    attachments: found.attachments,
  };
};

const kilobytes = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

export const formatForConsole = (message) => {
  const lines = [
    "",
    `[mocks] ✉ smtp #${message.id}  ${message.receivedAt}`,
    `  From:    ${message.envelopeFrom}`,
    `  To:      ${message.envelopeTo.join(", ")}`,
    `  Subject: ${message.subject || "(no subject)"}`,
  ];
  if (message.attachments.length > 0) {
    lines.push(
      `  Attach:  ${message.attachments.map((file) => `${file.filename} (${kilobytes(file.bytes)})`).join(", ")}`,
    );
  }
  lines.push("  ──────────");
  const body = message.text ?? (message.html ? "(HTML only — see /smtp/messages/" + message.id + ")" : "(empty)");
  lines.push(...body.split("\n").map((line) => `  ${line}`));
  lines.push("");
  return lines.join("\n");
};
