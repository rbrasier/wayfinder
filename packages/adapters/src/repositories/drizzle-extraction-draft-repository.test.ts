import { describe, expect, it } from "vitest";
import { toDraftDocument } from "./drizzle-extraction-draft-repository";

const row = (textLength: number | null) => ({
  id: "draft-1",
  flow_id: "flow-1",
  filename: "feed.txt",
  tree_path: "feed.txt",
  storage_key: "extraction-drafts/flow-1/feed.txt",
  mime_type: "text/plain",
  text_length: textLength,
  created_at: new Date(),
  updated_at: new Date(),
});

// Null is a distinct state — "size unknown", for rows staged before the column
// existed — so the mapping must not coerce it to 0, which means "no readable text".
describe("toDraftDocument — text length (issue #335)", () => {
  it("carries the measured text length through", () => {
    expect(toDraftDocument(row(1234)).textLength).toBe(1234);
    expect(toDraftDocument(row(0)).textLength).toBe(0);
  });

  it("keeps an unknown length as null rather than zero", () => {
    expect(toDraftDocument(row(null)).textLength).toBeNull();
  });
});
