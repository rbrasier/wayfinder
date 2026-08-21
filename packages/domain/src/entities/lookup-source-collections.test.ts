import { describe, it, expect } from "vitest";
import { COLLECTION_WALK_MAX_DEPTH, findRecordCollections } from "./lookup-source";

describe("findRecordCollections", () => {
  it("finds a root-level array of records", () => {
    const collections = findRecordCollections([
      { department: "Finance", department_code: "FIN-001" },
      { department: "HR", department_code: "HR-002" },
    ]);

    expect(collections).toHaveLength(1);
    expect(collections[0]?.path).toBe("");
    expect(collections[0]?.count).toBe(2);
    expect(collections[0]?.fields).toEqual(["department", "department_code"]);
  });

  it("finds an array nested under a dotted path", () => {
    const collections = findRecordCollections({ result: { items: [{ name: "Finance" }] } });

    expect(collections[0]?.path).toBe("result.items");
    expect(collections[0]?.fields).toEqual(["name"]);
  });

  it("returns every collection in one body, so the admin can choose", () => {
    const collections = findRecordCollections({
      departments: [{ name: "Finance" }],
      costCentres: [{ code: "CC-1" }, { code: "CC-2" }],
    });

    expect(collections.map((collection) => collection.path)).toEqual([
      "departments",
      "costCentres",
    ]);
    expect(collections[1]?.count).toBe(2);
  });

  it("carries a bounded sample of each collection", () => {
    const many = Array.from({ length: 40 }, (_, index) => ({ name: `Dept ${index}` }));

    const [collection] = findRecordCollections({ items: many });

    expect(collection?.count).toBe(40);
    expect(collection?.sample.length).toBeLessThanOrEqual(10);
    expect(collection?.sample[0]).toEqual({ name: "Dept 0" });
  });

  it("stringifies scalar values in the sample so any field can be display or key", () => {
    const [collection] = findRecordCollections([{ name: "Finance", headcount: 42, active: true }]);

    expect(collection?.sample[0]).toEqual({ name: "Finance", headcount: "42", active: "true" });
  });

  it("collects field names across records, not just the first", () => {
    const [collection] = findRecordCollections([{ name: "Finance" }, { name: "HR", code: "HR-2" }]);

    expect(collection?.fields).toEqual(["name", "code"]);
  });

  it("ignores an array of scalars, which cannot supply a display and a key", () => {
    expect(findRecordCollections({ tags: ["a", "b"] })).toEqual([]);
  });

  it("ignores an empty array, which tells the admin nothing", () => {
    expect(findRecordCollections({ items: [] })).toEqual([]);
  });

  it("ignores an array of arrays", () => {
    expect(findRecordCollections({ rows: [[1, 2], [3, 4]] })).toEqual([]);
  });

  it("returns nothing for a body with no collections at all", () => {
    expect(findRecordCollections({ department: "Finance" })).toEqual([]);
    expect(findRecordCollections("not json shaped")).toEqual([]);
    expect(findRecordCollections(null)).toEqual([]);
  });

  it("stops descending past the depth bound rather than walking a hostile body", () => {
    let deep: Record<string, unknown> = { items: [{ name: "too deep" }] };
    for (let level = 0; level <= COLLECTION_WALK_MAX_DEPTH + 1; level += 1) {
      deep = { nested: deep };
    }

    expect(findRecordCollections(deep)).toEqual([]);
  });

  it("finds a collection that sits just inside the depth bound", () => {
    let shallow: Record<string, unknown> = { items: [{ name: "reachable" }] };
    for (let level = 0; level < COLLECTION_WALK_MAX_DEPTH - 2; level += 1) {
      shallow = { nested: shallow };
    }

    expect(findRecordCollections(shallow).length).toBe(1);
  });

  it("caps how many collections it reports", () => {
    const wide: Record<string, unknown> = {};
    for (let index = 0; index < 60; index += 1) wide[`list${index}`] = [{ name: `n${index}` }];

    expect(findRecordCollections(wide).length).toBeLessThanOrEqual(20);
  });
});
