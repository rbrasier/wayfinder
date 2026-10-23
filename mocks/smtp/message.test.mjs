import { describe, expect, it } from "vitest";
import { formatForConsole, parseMessage } from "./message.mjs";

const crlf = (lines) => lines.join("\r\n");

describe("parseMessage", () => {
  it("reads the headers and a plain-text body", () => {
    const parsed = parseMessage(
      crlf([
        "From: Wayfinder <wayfinder@example.com>",
        "To: estimates@agency.gov.au",
        "Subject: Hearing pv-12 summary",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "The committee met.",
      ]),
    );

    expect(parsed).toMatchObject({
      from: "Wayfinder <wayfinder@example.com>",
      to: "estimates@agency.gov.au",
      subject: "Hearing pv-12 summary",
      text: "The committee met.",
      html: null,
      attachments: [],
    });
  });

  it("decodes an encoded-word subject and a quoted-printable body", () => {
    const parsed = parseMessage(
      crlf([
        "Subject: =?UTF-8?Q?Estimates_=E2=80=94_summary?=",
        "Content-Type: text/plain; charset=utf-8",
        "Content-Transfer-Encoding: quoted-printable",
        "",
        "A long line that is soft=",
        " wrapped =E2=80=94 then ends.",
      ]),
    );

    expect(parsed.subject).toBe("Estimates — summary");
    expect(parsed.text).toBe("A long line that is soft wrapped — then ends.");
  });

  it("takes the text and html parts of a multipart message and lists its attachments", () => {
    const parsed = parseMessage(
      crlf([
        "Subject: With parts",
        'Content-Type: multipart/mixed; boundary="outer"',
        "",
        "--outer",
        'Content-Type: multipart/alternative; boundary="inner"',
        "",
        "--inner",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "Plain words",
        "--inner",
        "Content-Type: text/html; charset=utf-8",
        "Content-Transfer-Encoding: base64",
        "",
        Buffer.from("<p>Plain words</p>").toString("base64"),
        "--inner--",
        "--outer",
        "Content-Type: application/pdf",
        'Content-Disposition: attachment; filename="summary.pdf"',
        "Content-Transfer-Encoding: base64",
        "",
        Buffer.from("%PDF-1.4 fake").toString("base64"),
        "--outer--",
      ]),
    );

    expect(parsed.text).toBe("Plain words");
    expect(parsed.html).toBe("<p>Plain words</p>");
    expect(parsed.attachments).toEqual([{ filename: "summary.pdf", contentType: "application/pdf", bytes: 13 }]);
  });
});

describe("formatForConsole", () => {
  it("prints who it went to, the subject, the attachments and the text", () => {
    const printed = formatForConsole({
      id: 3,
      envelopeFrom: "wayfinder@example.com",
      envelopeTo: ["a@agency.gov.au", "b@agency.gov.au"],
      receivedAt: "2026-10-23T10:00:00.000Z",
      subject: "Hearing summary",
      text: "The committee met.",
      html: "<p>The committee met.</p>",
      attachments: [{ filename: "summary.pdf", contentType: "application/pdf", bytes: 2048 }],
    });

    expect(printed).toContain("#3");
    expect(printed).toContain("a@agency.gov.au, b@agency.gov.au");
    expect(printed).toContain("Hearing summary");
    expect(printed).toContain("summary.pdf (2.0 KB)");
    expect(printed).toContain("The committee met.");
  });
});
