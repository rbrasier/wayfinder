import { createHash } from "node:crypto";
import PizZip from "pizzip";
import { describe, expect, it } from "vitest";
import {
  FLOW_ARCHIVE_LIMITS,
  FLOW_EXPORT_FORMAT_VERSION,
  type FlowArchiveAsset,
  type FlowArchiveLimits,
  type FlowExportManifest,
  type FlowSnapshot,
} from "@wayfinder/domain";
import { ZipFlowArchive } from "./zip-flow-archive";

const archive = new ZipFlowArchive();

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const snapshot: FlowSnapshot = {
  kind: "guided",
  flow: { name: "Procurement", description: null, icon: null, expertRole: null, contextDocs: [] },
  nodes: [
    {
      id: "node-1",
      type: "conversational",
      name: "Gather",
      colour: null,
      positionX: 0,
      positionY: 0,
      config: { aiInstruction: "Ask.", doneWhen: "Answered.", outputType: "unstructured" },
    },
  ],
  edges: [],
};

const templateBytes = Buffer.from("a docx template, near enough");

const assetOf = (id: string, bytes: Buffer): FlowArchiveAsset => ({
  asset: {
    id,
    kind: "template",
    path: `source/templates/${id}.docx`,
    filename: `${id}.docx`,
    mimeType: DOCX_MIME,
    sizeBytes: bytes.length,
    sha256: sha256(bytes),
  },
  bytes,
});

const manifestFor = (assets: FlowArchiveAsset[]): FlowExportManifest => ({
  formatVersion: FLOW_EXPORT_FORMAT_VERSION,
  exportedAt: "2026-08-17T09:00:00.000Z",
  exportedFrom: { appVersion: "0.30.0" },
  snapshot,
  dependencies: [],
  assets: assets.map((entry) => entry.asset),
});

const limits: FlowArchiveLimits = FLOW_ARCHIVE_LIMITS;

// Builds a zip by hand so a test can put things in it that the writer never
// would — an escaping path, a missing manifest, tampered bytes.
const handBuiltZip = (files: Record<string, Buffer | string>): Buffer => {
  const zip = new PizZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generate({ type: "nodebuffer" });
};

describe("ZipFlowArchive round trip", () => {
  it("writes a manifest and its assets, and reads both back intact", async () => {
    const assets = [assetOf("asset-1", templateBytes)];

    const written = await archive.write(manifestFor(assets), assets);
    expect(written.error).toBeUndefined();

    const read = await archive.read(written.data!, limits);

    expect(read.error).toBeUndefined();
    expect(read.data!.manifest.snapshot).toEqual(snapshot);
    expect(read.data!.assets.get("asset-1")).toEqual(templateBytes);
  });

  it("writes an archive with no assets at all", async () => {
    const written = await archive.write(manifestFor([]), []);
    const read = await archive.read(written.data!, limits);

    expect(read.error).toBeUndefined();
    expect(read.data!.assets.size).toBe(0);
  });

  it("keeps the snapshot byte-identical through the round trip, including unknown config fields", async () => {
    const withUnknownField: FlowSnapshot = {
      ...snapshot,
      nodes: [{ ...snapshot.nodes[0]!, config: { ...snapshot.nodes[0]!.config, fieldFromTheFuture: [1, 2] } }],
    };
    const manifest = { ...manifestFor([]), snapshot: withUnknownField };

    const written = await archive.write(manifest, []);
    const read = await archive.read(written.data!, limits);

    expect(read.data!.manifest.snapshot.nodes[0]!.config.fieldFromTheFuture).toEqual([1, 2]);
  });

  it("stores assets under their manifest id, never under the source filename", async () => {
    const assets = [assetOf("asset-1", templateBytes)];

    const written = await archive.write(manifestFor(assets), assets);

    const entries = Object.keys(new PizZip(written.data!).files);
    expect(entries).toContain("assets/asset-1");
    expect(entries.some((name) => name.includes("asset-1.docx"))).toBe(false);
  });
});

describe("ZipFlowArchive.read — malformed input", () => {
  it("returns a Result error for bytes that are not a zip", async () => {
    const result = await archive.read(Buffer.from("not a zip at all"), limits);

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("zip");
  });

  it("returns a Result error when the manifest is missing", async () => {
    const result = await archive.read(handBuiltZip({ "assets/asset-1": templateBytes }), limits);

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("manifest.json");
  });

  it("returns a Result error when the manifest is not valid JSON", async () => {
    const result = await archive.read(handBuiltZip({ "manifest.json": "{ not json" }), limits);

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("JSON");
  });

  it("returns a Result error when the manifest fails schema validation", async () => {
    const result = await archive.read(
      handBuiltZip({ "manifest.json": JSON.stringify({ formatVersion: 1 }) }),
      limits,
    );

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("missing required field");
  });

  it("refuses a manifest written in a newer format version", async () => {
    const manifest = { ...manifestFor([]), formatVersion: FLOW_EXPORT_FORMAT_VERSION + 1 };

    const result = await archive.read(handBuiltZip({ "manifest.json": JSON.stringify(manifest) }), limits);

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain(String(FLOW_EXPORT_FORMAT_VERSION + 1));
  });

  it("returns a Result error when a manifest asset has no bytes in the archive", async () => {
    const assets = [assetOf("asset-1", templateBytes)];

    const result = await archive.read(
      handBuiltZip({ "manifest.json": JSON.stringify(manifestFor(assets)) }),
      limits,
    );

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("asset-1");
  });
});

describe("ZipFlowArchive.read — untrusted paths", () => {
  it("rejects an entry whose path escapes the archive root", async () => {
    const result = await archive.read(
      handBuiltZip({
        "manifest.json": JSON.stringify(manifestFor([])),
        "../../etc/passwd": Buffer.from("owned"),
      }),
      limits,
    );

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("unsafe path");
  });

  it("rejects an absolute entry path", async () => {
    const result = await archive.read(
      handBuiltZip({
        "manifest.json": JSON.stringify(manifestFor([])),
        "/etc/shadow": Buffer.from("owned"),
      }),
      limits,
    );

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("unsafe path");
  });
});

describe("ZipFlowArchive.read — integrity", () => {
  it("fails when an asset's sha256 does not match, and does not return the bytes", async () => {
    const assets = [assetOf("asset-1", templateBytes)];
    const manifest = manifestFor(assets);

    const result = await archive.read(
      handBuiltZip({
        "manifest.json": JSON.stringify(manifest),
        "assets/asset-1": Buffer.from("tampered content"),
      }),
      limits,
    );

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("sha256");
    expect(result.data).toBeUndefined();
  });
});

describe("ZipFlowArchive.read — ceilings", () => {
  it("rejects an archive larger than the compressed ceiling before opening it", async () => {
    const written = await archive.write(manifestFor([]), []);

    const result = await archive.read(written.data!, { ...limits, maxArchiveBytes: 10 });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("10");
  });

  it("rejects an archive with more assets than the count ceiling", async () => {
    const assets = [assetOf("asset-1", templateBytes), assetOf("asset-2", templateBytes)];
    const written = await archive.write(manifestFor(assets), assets);

    const result = await archive.read(written.data!, { ...limits, maxAssetCount: 1 });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("1");
  });

  it("rejects an asset larger than the per-asset ceiling", async () => {
    const big = Buffer.alloc(4096, "x");
    const assets = [assetOf("asset-1", big)];
    const written = await archive.write(manifestFor(assets), assets);

    const result = await archive.read(written.data!, { ...limits, maxAssetBytes: 128 });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("128");
  });

  it("rejects an archive that decompresses past the uncompressed ceiling", async () => {
    const big = Buffer.alloc(8192, "x");
    const assets = [assetOf("asset-1", big)];
    const written = await archive.write(manifestFor(assets), assets);

    const result = await archive.read(written.data!, { ...limits, maxUncompressedBytes: 256 });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("bomb");
  });
});

describe("ZipFlowArchive.read — the regression that reusing ZipIngestor would have caused", () => {
  it("reads manifest.json, which a MIME-sniffing reader would silently drop", async () => {
    const written = await archive.write(manifestFor([]), []);

    const result = await archive.read(written.data!, limits);

    expect(result.error).toBeUndefined();
    expect(result.data!.manifest.exportedFrom.appVersion).toBe("0.30.0");
  });

  it("reads an xlsx asset, which a MIME-sniffing reader would silently drop", async () => {
    // A zip container whose name does not end in .docx — exactly what
    // `sniffMimeType` returns null for.
    const xlsxBytes = handBuiltZip({ "xl/workbook.xml": "<workbook/>" });
    const asset: FlowArchiveAsset = {
      asset: {
        id: "asset-xlsx",
        kind: "template",
        path: "source/templates/report.xlsx",
        filename: "report.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        sizeBytes: xlsxBytes.length,
        sha256: sha256(xlsxBytes),
      },
      bytes: xlsxBytes,
    };

    const written = await archive.write(manifestFor([asset]), [asset]);
    const result = await archive.read(written.data!, limits);

    expect(result.error).toBeUndefined();
    expect(result.data!.assets.get("asset-xlsx")).toEqual(xlsxBytes);
  });
});
