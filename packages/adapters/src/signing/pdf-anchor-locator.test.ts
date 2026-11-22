import { describe, expect, it } from "vitest";
import { PdfJsAnchorLocator } from "./pdf-anchor-locator";

// A one-page A4 PDF with text lines at given baselines, xref offsets correct.
const pdfWith = (lines: Array<{ text: string; x: number; y: number }>): Buffer => {
  const stream = lines.map((line) => `BT /F1 12 Tf ${line.x} ${line.y} Td (${line.text}) Tj ET`).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.7\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
};

describe("PdfJsAnchorLocator", () => {
  it("finds a marker and reports its position from the top-left of the page", async () => {
    const pdf = pdfWith([
      { text: "Delegate approval", x: 72, y: 760 },
      { text: "WFSLOTdelegatesignatureWF", x: 90, y: 700 },
    ]);

    const result = await new PdfJsAnchorLocator().locate(pdf, ["WFSLOTdelegatesignatureWF"]);

    const rectangle = result.data!.WFSLOTdelegatesignatureWF!;
    expect(rectangle.page).toBe(1);
    expect(rectangle.x).toBeCloseTo(90, 0);
    expect(rectangle.y).toBeCloseTo(842 - 700 - 12, 0);
  });

  it("leaves out a marker that is not in the document", async () => {
    const result = await new PdfJsAnchorLocator().locate(pdfWith([{ text: "Nothing here", x: 72, y: 700 }]), [
      "WFSLOTmissingWF",
    ]);

    expect(result.data).toEqual({});
  });

  it("fails on bytes that are not a PDF", async () => {
    const result = await new PdfJsAnchorLocator().locate(Buffer.from("not a pdf"), ["X"]);

    expect(result.error?.code).toBe("INFRA_FAILURE");
  });
});
