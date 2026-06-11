import { describe, it, expect } from "vitest";
import {
  domainError,
  err,
  ok,
  type IPeopleDirectory,
  type PeopleSearchInput,
  type Person,
  type Result,
} from "@rbrasier/domain";
import { SearchPeople } from "./search-people";

const person = (overrides: Partial<Person> & Pick<Person, "email" | "source">): Person => ({
  directoryId: null,
  userId: null,
  displayName: null,
  jobTitle: null,
  department: null,
  ...overrides,
});

class StubDirectory implements IPeopleDirectory {
  constructor(private readonly people: Person[]) {}
  async search(_input: PeopleSearchInput): Promise<Result<Person[]>> {
    return ok(this.people);
  }
}

class FailingDirectory implements IPeopleDirectory {
  async search(_input: PeopleSearchInput): Promise<Result<Person[]>> {
    return err(domainError("INFRA_FAILURE", "graph unavailable"));
  }
}

describe("SearchPeople", () => {
  it("federates results from every source", async () => {
    const entra = new StubDirectory([person({ source: "entra", email: "ada@corp.test" })]);
    const hr = new StubDirectory([person({ source: "hr", email: "ben@corp.test" })]);
    const sut = new SearchPeople([entra, hr]);

    const result = await sut.execute({ query: "corp", limit: 10 });

    expect(result.error).toBeUndefined();
    expect(result.data?.map((p) => p.email).sort()).toEqual(["ada@corp.test", "ben@corp.test"]);
  });

  it("de-duplicates by email, preferring the record tied to an account", async () => {
    const hr = new StubDirectory([person({ source: "hr", email: "Ada@corp.test" })]);
    const entra = new StubDirectory([
      person({ source: "entra", email: "ada@corp.test", userId: "user-1" }),
    ]);
    const sut = new SearchPeople([hr, entra]);

    const result = await sut.execute({ query: "ada", limit: 10 });

    expect(result.data).toHaveLength(1);
    expect(result.data?.[0]?.userId).toBe("user-1");
  });

  it("appends a free-typed email that no source returned", async () => {
    const sut = new SearchPeople([new StubDirectory([])]);

    const result = await sut.execute({ query: "someone@external.test", limit: 10 });

    expect(result.data).toHaveLength(1);
    expect(result.data?.[0]).toMatchObject({ source: "email", email: "someone@external.test" });
  });

  it("does not append a typed email when a source already returned it", async () => {
    const entra = new StubDirectory([
      person({ source: "entra", email: "ada@corp.test", userId: "user-1" }),
    ]);
    const sut = new SearchPeople([entra]);

    const result = await sut.execute({ query: "ada@corp.test", limit: 10 });

    expect(result.data).toHaveLength(1);
    expect(result.data?.[0]?.source).toBe("entra");
  });

  it("skips a failing source instead of failing the whole search", async () => {
    const sut = new SearchPeople([
      new FailingDirectory(),
      new StubDirectory([person({ source: "hr", email: "ben@corp.test" })]),
    ]);

    const result = await sut.execute({ query: "ben", limit: 10 });

    expect(result.error).toBeUndefined();
    expect(result.data?.map((p) => p.email)).toEqual(["ben@corp.test"]);
  });

  it("respects the limit", async () => {
    const many = Array.from({ length: 5 }, (_unused, index) =>
      person({ source: "hr", email: `person-${index}@corp.test` }),
    );
    const sut = new SearchPeople([new StubDirectory(many)]);

    const result = await sut.execute({ query: "person", limit: 2 });

    expect(result.data).toHaveLength(2);
  });
});
