import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LocalPdfConverter, type ConverterRun } from "./local-pdf-converter";

const argValue = (args: string[], prefix: string) => args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);

// Stands in for LibreOffice: writes `document.pdf` into --outdir, as soffice does.
const fakeSoffice = (output: string | null = "%PDF-1.7 converted") => {
  const calls: string[][] = [];
  const run: ConverterRun = async (_command, args) => {
    calls.push(args);
    const outdir = args[args.indexOf("--outdir") + 1]!;
    if (output !== null) await writeFile(join(outdir, "document.pdf"), output);
    return { exitCode: 0, timedOut: false };
  };
  return { run, calls };
};

const build = async (run: ConverterRun, overrides: { isInstalled?: () => boolean; concurrency?: number } = {}) => {
  const tempRoot = await mkdtemp(join(tmpdir(), "converter-test-"));
  const converter = new LocalPdfConverter({
    sofficePath: "/usr/bin/soffice",
    isInstalled: overrides.isInstalled ?? (() => true),
    run,
    tempRoot,
    concurrency: overrides.concurrency ?? 2,
    timeoutMs: 60_000,
  });
  return { converter, tempRoot };
};

describe("LocalPdfConverter", () => {
  it("converts a document to PDF/A-2b with LibreOffice and returns the PDF", async () => {
    const soffice = fakeSoffice();
    const { converter } = await build(soffice.run);

    const result = await converter.convertDocxToPdfA(Buffer.from("docx bytes"));

    expect(result.data?.toString()).toBe("%PDF-1.7 converted");
    const args = soffice.calls[0]!;
    expect(args).toContain("--headless");
    expect(args).toContain('pdf:writer_pdf_Export:{"SelectPdfVersion":{"type":"long","value":"2"}}');
    expect(args.at(-1)).toMatch(/document\.docx$/);
  });

  it("gives every conversion its own LibreOffice profile, so two can run at once", async () => {
    const soffice = fakeSoffice();
    const { converter } = await build(soffice.run);

    await Promise.all([converter.convertDocxToPdfA(Buffer.from("a")), converter.convertDocxToPdfA(Buffer.from("b"))]);

    const profiles = soffice.calls.map((args) => argValue(args, "-env:UserInstallation="));
    expect(new Set(profiles).size).toBe(2);
  });

  it("removes its working files afterwards, whatever the outcome", async () => {
    const { converter, tempRoot } = await build(fakeSoffice(null).run);

    await converter.convertDocxToPdfA(Buffer.from("docx"));

    expect(await readdir(tempRoot)).toEqual([]);
  });

  it("fails closed when LibreOffice produces no PDF", async () => {
    const { converter } = await build(fakeSoffice(null).run);

    const result = await converter.convertDocxToPdfA(Buffer.from("docx"));

    expect(result.error?.code).toBe("INFRA_FAILURE");
  });

  it("fails closed when the output is not a PDF", async () => {
    const { converter } = await build(fakeSoffice("<html>").run);

    const result = await converter.convertDocxToPdfA(Buffer.from("docx"));

    expect(result.error?.message).toContain("not a PDF");
  });

  it("fails closed when LibreOffice runs past the timeout", async () => {
    const { converter } = await build(async () => ({ exitCode: null, timedOut: true }));

    const result = await converter.convertDocxToPdfA(Buffer.from("docx"));

    expect(result.error?.message).toContain("took too long");
  });

  it("says plainly when this image has no LibreOffice", async () => {
    const soffice = fakeSoffice();
    const { converter } = await build(soffice.run, { isInstalled: () => false });

    const result = await converter.convertDocxToPdfA(Buffer.from("docx"));

    expect(result.error?.message).toContain("doesn't include the built-in engine");
    expect(soffice.calls).toEqual([]);
    expect(converter.status()).toBe("unavailable");
  });

  it("runs no more conversions at once than its concurrency allows, and reports itself running meanwhile", async () => {
    let active = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    const run: ConverterRun = async (_command, args) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      await writeFile(join(args[args.indexOf("--outdir") + 1]!, "document.pdf"), "%PDF-1.7");
      active -= 1;
      return { exitCode: 0, timedOut: false };
    };
    const { converter } = await build(run, { concurrency: 1 });
    expect(converter.status()).toBe("idle");

    const jobs = [converter.convertDocxToPdfA(Buffer.from("a")), converter.convertDocxToPdfA(Buffer.from("b"))];
    while (releases.length === 0) await new Promise((resolve) => setTimeout(resolve, 1));
    expect(converter.status()).toBe("running");
    while (releases.length > 0 || active > 0) {
      releases.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await Promise.all(jobs);

    expect(peak).toBe(1);
    expect(converter.status()).toBe("idle");
  });
});
