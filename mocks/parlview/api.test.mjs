import { describe, expect, it } from "vitest";
import { formStructure, json, request, response } from "../test-support/http.mjs";
import { createParlviewMock, mock } from "./api.mjs";
import { createClock } from "./clock.mjs";

const PERIOD = 5 * 60 * 1000;
const SLOT = 5_976_000;
const FORM = { "Content-Type": "application/x-www-form-urlencoded" };

const build = () => {
  let wallClock = SLOT * PERIOD + 120_000;
  const posted = [];
  const parlview = createParlviewMock({
    clock: createClock(() => wallClock),
    periodMs: PERIOD,
    webhookTarget: null,
    post: async (url, init) => {
      posted.push({ url, ...init });
      return { status: 202 };
    },
    log: () => {},
    mcpToken: "mock-parlview-token",
  });
  const call = async (method, url, body = null, headers = {}) => {
    const res = response();
    const raw = body === null || typeof body === "string" ? body : JSON.stringify(body);
    await parlview.handle(request(method, url, raw, headers), res);
    return res.recorded;
  };
  return { parlview, call, posted, tick: (ms) => (wallClock += ms) };
};

const videos = async (call) => json(await call("GET", "/parlview/vodapi/api/search?pageSize=40&page=0")).searchResults.videos;
const liveId = async (call) => (await videos(call)).find((video) => video.isLive).parlViewId;

describe("mock registration", () => {
  it("claims the /parlview path", () => {
    expect(mock.path).toBe("/parlview");
    expect(mock.label).toContain("parlview");
  });
});

describe("GET /parlview/vodapi/api/search", () => {
  it("lists recordings the way vodapi does, newest first", async () => {
    const { call } = build();
    const recorded = await call("GET", "/parlview/vodapi/api/search?pageSize=40&page=0&searchTerm=");

    expect(recorded.statusCode).toBe(200);
    const { searchResults } = json(recorded);
    expect(searchResults.totalItems).toBe(searchResults.videos.length);
    expect(searchResults.videos[0]).toMatchObject({ parlViewId: String(SLOT), isLive: true });
    expect(searchResults.videos.slice(1).every((video) => !video.isLive)).toBe(true);
  });

  it("pages with page and pageSize", async () => {
    const { call } = build();
    const { searchResults } = json(await call("GET", "/parlview/vodapi/api/search?pageSize=2&page=1"));

    expect(searchResults.videos.map((video) => video.parlViewId)).toEqual([String(SLOT - 2), String(SLOT - 3)]);
  });

  it("turns the live recording's isLive false after one period", async () => {
    const { call, tick } = build();
    const before = await liveId(call);
    tick(PERIOD);

    expect((await videos(call)).find((video) => video.parlViewId === before).isLive).toBe(false);
  });
});

describe("ParlView's per-recording endpoints", () => {
  it("returns vodapi details, or 404", async () => {
    const { call } = build();

    expect(json(await call("GET", `/parlview/vodapi/api/search/${SLOT}`)).videoDetails.parlViewId).toBe(String(SLOT));
    expect((await call("GET", `/parlview/vodapi/api/search/${SLOT + 1}`)).statusCode).toBe(404);
  });

  it("returns eventvideos chunks, with ParlView's empty answer for an unknown id", async () => {
    const { call } = build();

    expect(json(await call("GET", `/parlview/vod/api/videos/eventvideos/${SLOT - 1}`)).Chunks).toHaveLength(1);
    expect(json(await call("GET", "/parlview/vod/api/videos/eventvideos/12")).Chunks).toEqual([]);
  });

  it("returns caption lines for a POSTed offset range", async () => {
    const { call } = build();
    const all = json(await call("POST", `/parlview/vod/api/videos/captions/${SLOT - 1}`, { fromOffset: 0, toOffset: 0, timecodeFormat: "Pal" }));
    const firstMinute = json(
      await call("POST", `/parlview/vod/api/videos/captions/${SLOT - 1}`, { fromOffset: 0, toOffset: 60_000, timecodeFormat: "Pal" }),
    );

    expect(all[0]).toMatchObject({ In: expect.stringMatching(/^\d{2}:\d{2}:\d{2}:\d{2}$/), Text: expect.any(String) });
    expect(firstMinute.length).toBeLessThan(all.length);
  });

  it("405s a GET of the captions API, which only takes POST", async () => {
    const { call } = build();
    expect((await call("GET", `/parlview/vod/api/videos/captions/${SLOT}`)).statusCode).toBe(405);
  });
});

describe("POST /parlview/api/advance", () => {
  it("jumps to the next change without waiting out the period", async () => {
    const { call } = build();
    const before = await liveId(call);

    const advanced = await call("POST", "/parlview/api/advance");

    expect(advanced.statusCode).toBe(200);
    expect(json(advanced).advancedBySeconds).toBe(180);
    expect((await videos(call)).find((video) => video.parlViewId === before).isLive).toBe(false);
  });

  it("sends the landing page's button back to the page with what changed", async () => {
    const { call } = build();

    const advanced = await call("POST", "/parlview/api/advance", "", FORM);

    expect(advanced.statusCode).toBe(303);
    const location = decodeURIComponent(advanced.headers.Location);
    expect(location).toBe(`/parlview?notice=Skipped 180s: ${SLOT} finished and ${SLOT + 1} is live.`);
    expect(await liveId(call)).toBe(String(SLOT + 1));
  });
});

describe("/parlview/api/webhook", () => {
  it("calls a flow's webhook when a hearing finishes, once one is set", async () => {
    const { parlview, call, posted } = build();
    await parlview.tick();

    const saved = await call("POST", "/parlview/api/webhook", {
      url: "http://localhost:3000/api/triggers/flow-1",
      token: "wf_wh_abc",
    });
    await call("POST", "/parlview/api/advance");

    expect(saved.statusCode).toBe(200);
    expect(json(saved)).toEqual({
      webhook: { url: "http://localhost:3000/api/triggers/flow-1", hasToken: true, signsWithHmac: false },
    });
    expect(posted).toHaveLength(1);
    expect(JSON.parse(posted[0].body).inputs).toMatchObject({ hearing_id: String(SLOT), status: "finished" });
  });

  it("refuses a webhook without a url and token", async () => {
    const { call } = build();
    expect((await call("POST", "/parlview/api/webhook", { url: "http://x" })).statusCode).toBe(400);
  });

  it("stops calling once the webhook is removed", async () => {
    const { parlview, call, posted } = build();
    await parlview.tick();
    await call("POST", "/parlview/api/webhook", { url: "http://x/hook", token: "t" });
    await call("DELETE", "/parlview/api/webhook");
    await call("POST", "/parlview/api/advance");

    expect(json(await call("GET", "/parlview/api/webhook"))).toEqual({ webhook: null });
    expect(posted).toEqual([]);
  });

  it("is set and stopped from the landing page's forms", async () => {
    const { call } = build();

    const saved = await call("POST", "/parlview/api/webhook", "url=http%3A%2F%2Fx%2Fhook&token=t&hmacSecret=s", FORM);
    expect(saved.statusCode).toBe(303);
    expect(json(await call("GET", "/parlview/api/webhook")).webhook).toEqual({ url: "http://x/hook", hasToken: true, signsWithHmac: true });

    const stopped = await call("POST", "/parlview/api/webhook", "stop=1", FORM);
    expect(stopped.statusCode).toBe(303);
    expect(json(await call("GET", "/parlview/api/webhook")).webhook).toBeNull();
  });
});

describe("GET /parlview", () => {
  it("shows what is live with a button to advance, links to each endpoint, and the setups", async () => {
    const { call } = build();
    const recorded = await call("GET", "/parlview");

    expect(recorded.statusCode).toBe(200);
    expect(recorded.headers["Content-Type"]).toContain("text/html");
    expect(recorded.body).toContain(`action="/parlview/api/advance"`);
    expect(recorded.body).toContain("Advance to next change");
    expect(recorded.body).toContain(`href="/parlview/video/${SLOT}"`);
    expect(recorded.body).toContain(`href="/parlview/vodapi/api/search/${SLOT - 1}"`);
    expect(recorded.body).toContain("searchResults.videos");
    expect(recorded.body).toContain("http://localhost:4001/parlview/mcp");
    expect(recorded.body).toContain("http://localhost:4001/parlview/mcp/mock-parlview-token");
  });

  it("closes every form, so each button posts its own fields", async () => {
    const { call } = build();
    await call("POST", "/parlview/api/webhook", { url: "http://x/hook", token: "t" });

    const structure = formStructure((await call("GET", "/parlview")).body);

    expect(structure).toEqual({ opened: 3, swallowed: [], unclosed: false });
  });

  it("shows the notice a button sent it back with, escaped", async () => {
    const { call } = build();
    const body = (await call("GET", "/parlview?notice=%3Cb%3Edone%3C%2Fb%3E")).body;

    expect(body).toContain("&#60;b&#62;done&#60;/b&#62;");
  });
});

describe("GET /parlview/video/:id", () => {
  it("shows a recording's captions and marks the moment a deep link points at", async () => {
    const { call } = build();
    const recorded = await call("GET", `/parlview/video/${SLOT - 1}?startTime=90`);

    expect(recorded.statusCode).toBe(200);
    expect(recorded.body).toContain("I declare open this hearing of");
    expect(recorded.body.match(/class="moment"/g)).toHaveLength(1);
  });

  it("404s a recording that has not started", async () => {
    const { call } = build();
    expect((await call("GET", `/parlview/video/${SLOT + 1}`)).statusCode).toBe(404);
  });
});

describe("rejections", () => {
  it("404s an unknown path", async () => {
    const { call } = build();
    expect((await call("GET", "/parlview/elsewhere")).statusCode).toBe(404);
  });

  it("405s a write to the vodapi listing", async () => {
    const { call } = build();
    expect((await call("DELETE", "/parlview/vodapi/api/search")).statusCode).toBe(405);
  });
});
