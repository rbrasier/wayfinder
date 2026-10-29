import { describe, expect, it } from "vitest";
import { readUploadedExamples } from "./template-draft-upload";

const docx = (name: string, bytes = 10) => new File([new Uint8Array(bytes)], name);

const formWith = (files: File[], baseIndex?: string) => {
  const form = new FormData();
  for (const file of files) form.append("files", file);
  if (baseIndex !== undefined) form.append("baseIndex", baseIndex);
  return form;
};

describe("readUploadedExamples", () => {
  it("reads every example and puts the chosen base first", async () => {
    const result = await readUploadedExamples(formWith([docx("a.docx"), docx("b.docx"), docx("c.docx")], "1"));

    expect(result.error).toBeUndefined();
    expect(result.data?.base.filename).toBe("b.docx");
    expect(result.data?.others.map((example) => example.filename)).toEqual(["a.docx", "c.docx"]);
  });

  it("uses the first example as the base when none is chosen", async () => {
    const result = await readUploadedExamples(formWith([docx("a.docx"), docx("b.docx")]));
    expect(result.data?.base.filename).toBe("a.docx");
  });

  it("makes the base filename safe for storage", async () => {
    const result = await readUploadedExamples(formWith([docx("Supply agreement (2024).docx")]));
    expect(result.data?.base.safeFilename).toBe("Supply_agreement__2024_.docx");
  });

  it("asks for an example when none was sent", async () => {
    const result = await readUploadedExamples(formWith([]));
    expect(result.error?.status).toBe(400);
    expect(result.error?.body.error).toBe("Add at least one example document.");
  });

  it("refuses more than ten examples", async () => {
    const files = Array.from({ length: 11 }, (_, index) => docx(`e${index}.docx`));
    const result = await readUploadedExamples(formWith(files));
    expect(result.error?.body.error).toBe("Upload up to 10 examples at a time.");
  });

  it("names each file that is not a Word document", async () => {
    const result = await readUploadedExamples(formWith([docx("a.docx"), docx("prices.xlsx"), docx("scan.pdf")]));

    expect(result.error?.status).toBe(400);
    expect(result.error?.body.details).toEqual([
      { subject: "prices.xlsx", message: "Only Word (.docx) files can be used as examples." },
      { subject: "scan.pdf", message: "Only Word (.docx) files can be used as examples." },
    ]);
  });

  it("names a file over the 10 MB limit", async () => {
    const result = await readUploadedExamples(formWith([docx("big.docx", 10 * 1024 * 1024 + 1)]));
    expect(result.error?.body.details).toEqual([{ subject: "big.docx", message: "Over the 10 MB limit." }]);
  });

  it("refuses examples that total more than 25 MB", async () => {
    const nineMegabytes = 9 * 1024 * 1024;
    const result = await readUploadedExamples(
      formWith([docx("a.docx", nineMegabytes), docx("b.docx", nineMegabytes), docx("c.docx", nineMegabytes)]),
    );
    expect(result.error?.body.error).toBe("Together the examples are over 25 MB. Remove one and try again.");
  });

  it("refuses a base choice outside the examples sent", async () => {
    const result = await readUploadedExamples(formWith([docx("a.docx")], "3"));
    expect(result.error?.status).toBe(400);
  });
});
