import { describe, expect, it } from "vitest";
import { EXPORT_MENU_FORMATS, exportArtifact, exportLabel } from "./export-format";

const JSON_ENTRY = EXPORT_MENU_FORMATS[0]!;
const CSV_ENTRY = EXPORT_MENU_FORMATS[1]!;

describe("exportArtifact", () => {
  it("maps each format to the artifact route segment that serves it", () => {
    expect(exportArtifact("xlsx")).toBe("export-xlsx");
    expect(exportArtifact("json")).toBe("export-json");
    expect(exportArtifact("csv")).toBe("export-csv");
  });
});

describe("EXPORT_MENU_FORMATS", () => {
  // Excel keeps the primary button beside the menu, so it is deliberately absent
  // here; CSV joins JSON as a secondary format rather than taking a third button.
  it("lists the secondary formats in menu order, JSON then CSV", () => {
    expect(EXPORT_MENU_FORMATS).toEqual([
      { format: "json", label: "Download JSON" },
      { format: "csv", label: "Download CSV" },
    ]);
  });

  it("does not offer Excel in the menu", () => {
    expect(EXPORT_MENU_FORMATS.some((entry) => entry.format === "xlsx")).toBe(false);
  });
});

describe("exportLabel", () => {
  it("reads as its format while nothing is downloading", () => {
    expect(exportLabel(JSON_ENTRY, null)).toBe("Download JSON");
    expect(exportLabel(CSV_ENTRY, null)).toBe("Download CSV");
  });

  it("reads as preparing only on the format the operator pressed", () => {
    expect(exportLabel(CSV_ENTRY, "csv")).toBe("Preparing…");
    expect(exportLabel(JSON_ENTRY, "csv")).toBe("Download JSON");
  });

  it("leaves both menu formats reading normally while Excel prepares", () => {
    expect(exportLabel(JSON_ENTRY, "xlsx")).toBe("Download JSON");
    expect(exportLabel(CSV_ENTRY, "xlsx")).toBe("Download CSV");
  });
});
