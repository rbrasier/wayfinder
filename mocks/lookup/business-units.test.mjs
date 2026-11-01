import { describe, expect, it } from "vitest";
import { json, request, response } from "../test-support/http.mjs";
import { mock } from "./business-units.mjs";

const CREDENTIAL = `Basic ${Buffer.from("bu-service:s3cr3t-mock-pw").toString("base64")}`;

const call = async (method, url, headers = {}) => {
  const res = response();
  await mock.handle(request(method, url, null, headers), res);
  return res.recorded;
};

const authorised = (url) => call("GET", url, { Authorization: CREDENTIAL });
const page = async (url) => json(await authorised(url));

// Walks the whole set the way ApiValueSetAdapter does, so the test proves the
// endpoint can actually be paginated to exhaustion rather than just that one
// page comes back.
const walk = async (nextUrl) => {
  const codes = [];
  for (let requests = 0; requests < 40; requests += 1) {
    const body = await page(nextUrl(codes.length, codes));
    codes.push(...body.items.map((unit) => unit.unit_code));
    if (!body.page.has_more) break;
    if (body.items.length === 0) break;
    codes.cursor = body.page.next_cursor;
  }
  return codes;
};

describe("mock registration", () => {
  it("claims the /lookup/business-units path", () => {
    expect(mock.path).toBe("/lookup/business-units");
    expect(mock.label).toContain("business units");
  });
});

describe("basic authentication", () => {
  it("401s with a challenge when no credential is sent", async () => {
    const recorded = await call("GET", "/lookup/business-units");

    expect(recorded.statusCode).toBe(401);
    expect(recorded.headers["WWW-Authenticate"]).toContain("Basic");
  });

  it("401s on the wrong password", async () => {
    const wrong = `Basic ${Buffer.from("bu-service:wrong").toString("base64")}`;

    expect((await call("GET", "/lookup/business-units", { Authorization: wrong })).statusCode).toBe(
      401,
    );
  });

  it("401s on a credential that is not valid base64 at all", async () => {
    const recorded = await call("GET", "/lookup/business-units", { Authorization: "Basic !!!" });

    expect(recorded.statusCode).toBe(401);
  });

  it("accepts the scheme in any case", async () => {
    const lowered = CREDENTIAL.replace("Basic", "basic");

    expect(
      (await call("GET", "/lookup/business-units", { Authorization: lowered })).statusCode,
    ).toBe(200);
  });
});

describe("the set itself", () => {
  it("holds five thousand units", async () => {
    expect((await page("/lookup/business-units?limit=1")).page.total).toBe(5_000);
  });

  it("keys every unit uniquely across the whole walk", async () => {
    const codes = await walk((offset) => `/lookup/business-units?offset=${offset}&limit=500`);

    expect(codes).toHaveLength(5_000);
    expect(new Set(codes).size).toBe(5_000);
  });

  it("names units the way an organisation does, not the way an operator asks", async () => {
    const names = (await page("/lookup/business-units?limit=250")).items.map(
      (unit) => unit.unit_name,
    );

    // The semantic gap is the whole point of this set: no letters connect
    // "procurement" or "HR" to what these are actually called.
    expect(names.some((name) => name.startsWith("Sourcing & Supplier Management"))).toBe(true);
    expect(names.some((name) => name.startsWith("People & Culture"))).toBe(true);
    expect(names.join(" ")).not.toContain("Procurement");
  });

  it("repeats each function across five sites, so a near-miss has no clear winner", async () => {
    // This is what stops the near-certain rule correcting "Sourcing Germany":
    // five entries score alike, so there is a strong match but no clear one.
    const body = await page("/lookup/business-units?q=Sourcing%20%26%20Supplier&limit=1000");
    const german = body.items.filter((unit) => unit.country === "Germany");

    expect(body.page.total).toBe(200); // 40 countries x 5 sites
    expect(german).toHaveLength(5);
    expect(new Set(german.map((unit) => unit.unit_name)).size).toBe(5);
    expect(new Set(german.map((unit) => unit.unit_code)).size).toBe(5);
  });
});

describe("pagination", () => {
  it("advances by offset", async () => {
    const first = await page("/lookup/business-units?offset=0&limit=250");
    const second = await page("/lookup/business-units?offset=250&limit=250");

    expect(second.page.offset).toBe(250);
    expect(second.items[0].unit_code).not.toBe(first.items[0].unit_code);
  });

  it("does not read a missing page parameter as page zero", async () => {
    // Number(null) is 0, so a naive reader pins an offset-style walk to the
    // first page forever. This is the bug that made a 5,000-entry walk return
    // 250 unique records twenty times over.
    const second = await page("/lookup/business-units?offset=250&limit=250");

    expect(second.page.offset).toBe(250);
  });

  it("advances by page number, counting from one", async () => {
    const body = await page("/lookup/business-units?page=2&per_page=250");

    expect(body.page.offset).toBe(250);
  });

  it("advances by cursor", async () => {
    const first = await page("/lookup/business-units?limit=1000");
    expect(first.page.next_cursor).toBeTruthy();

    const second = await page(`/lookup/business-units?cursor=${first.page.next_cursor}&limit=1000`);
    expect(second.page.offset).toBe(1_000);
    expect(second.items[0].unit_code).not.toBe(first.items[0].unit_code);
  });

  it("stops offering a cursor once the set is exhausted", async () => {
    const last = await page("/lookup/business-units?offset=4500&limit=1000");

    expect(last.items).toHaveLength(500);
    expect(last.page.has_more).toBe(false);
    expect(last.page.next_cursor).toBeNull();
  });

  it("reaches every record by cursor as well as by offset", async () => {
    const codes = [];
    let cursor = null;
    for (let requests = 0; requests < 25; requests += 1) {
      const query = cursor ? `cursor=${cursor}&limit=500` : "limit=500";
      const body = await page(`/lookup/business-units?${query}`);
      codes.push(...body.items.map((unit) => unit.unit_code));
      cursor = body.page.next_cursor;
      if (!cursor) break;
    }

    expect(new Set(codes).size).toBe(5_000);
  });

  it("defaults to a page size that clears the adapter's twenty-page cap", async () => {
    // 250 x 20 = 5,000 exactly. A smaller default would silently truncate the
    // set for anyone who does not set the size themselves.
    expect((await page("/lookup/business-units")).page.limit).toBe(250);
  });

  it("caps an absurd page size rather than serving the whole set at once", async () => {
    expect((await page("/lookup/business-units?limit=99999")).page.limit).toBe(1_000);
  });

  it("returns an empty page past the end rather than failing", async () => {
    const body = await page("/lookup/business-units?offset=9999&limit=250");

    expect(body.items).toEqual([]);
    expect(body.page.has_more).toBe(false);
  });
});

describe("rejections", () => {
  it("405s a write", async () => {
    const recorded = await call("POST", "/lookup/business-units", { Authorization: CREDENTIAL });

    expect(recorded.statusCode).toBe(405);
  });
});
