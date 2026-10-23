import { describe, expect, it } from "vitest";
import { json, request, response } from "../test-support/http.mjs";
import { createParlviewMock, mock } from "./api.mjs";
import { createClock } from "./clock.mjs";

const PERIOD = 5 * 60 * 1000;

const build = () => {
  let wallClock = 5_000_000 * PERIOD + 1_000;
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
  });
  const call = async (method, url, body = null) => {
    const res = response();
    await parlview.handle(request(method, url, body === null ? null : JSON.stringify(body)), res);
    return res.recorded;
  };
  return { parlview, call, posted, tick: (ms) => (wallClock += ms) };
};

const liveId = (body) => body.data.hearings.find((hearing) => hearing.status === "live").id;

describe("mock registration", () => {
  it("claims the /parlview path", () => {
    expect(mock.path).toBe("/parlview");
    expect(mock.label).toContain("parlview");
  });
});

describe("GET /parlview/api/hearings", () => {
  it("lists hearings under data.hearings with when the next change is due", async () => {
    const { call } = build();
    const recorded = await call("GET", "/parlview/api/hearings");

    expect(recorded.statusCode).toBe(200);
    const body = json(recorded);
    expect(body.data.hearings.length).toBeGreaterThan(0);
    expect(body.meta.periodSeconds).toBe(300);
    expect(Date.parse(body.meta.nextChangeAt)).toBeGreaterThan(Date.parse(body.meta.generatedAt));
  });

  it("filters by status", async () => {
    const { call } = build();
    const body = json(await call("GET", "/parlview/api/hearings?status=live"));

    expect(body.data.hearings).toHaveLength(1);
  });

  it("moves the live hearing to finished after one period", async () => {
    const { call, tick } = build();
    const before = liveId(json(await call("GET", "/parlview/api/hearings")));
    tick(PERIOD);
    const after = json(await call("GET", "/parlview/api/hearings"));

    expect(after.data.hearings.find((hearing) => hearing.id === before).status).toBe("finished");
  });
});

describe("POST /parlview/api/advance", () => {
  it("jumps to the next change without waiting out the period", async () => {
    const { call } = build();
    const before = liveId(json(await call("GET", "/parlview/api/hearings")));

    const advanced = await call("POST", "/parlview/api/advance");
    const after = json(await call("GET", "/parlview/api/hearings"));

    expect(advanced.statusCode).toBe(200);
    expect(after.data.hearings.find((hearing) => hearing.id === before).status).toBe("finished");
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
    expect(JSON.parse(posted[0].body).inputs.status).toBe("finished");
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
});

describe("GET /parlview/api/hearings/:id", () => {
  it("returns one hearing with its transcript", async () => {
    const { call } = build();
    const id = liveId(json(await call("GET", "/parlview/api/hearings")));

    const recorded = await call("GET", `/parlview/api/hearings/${id}`);

    expect(recorded.statusCode).toBe(200);
    expect(json(recorded).data.id).toBe(id);
    expect(json(recorded).data.transcript.length).toBeGreaterThan(0);
  });

  it("404s an unknown hearing", async () => {
    const { call } = build();
    expect((await call("GET", "/parlview/api/hearings/nope")).statusCode).toBe(404);
  });
});

describe("GET /parlview", () => {
  it("explains how to point an Event Watch at it", async () => {
    const { call } = build();
    const recorded = await call("GET", "/parlview");

    expect(recorded.statusCode).toBe(200);
    expect(recorded.body).toContain("/parlview/api/hearings");
    expect(recorded.body).toContain("data.hearings");
  });
});

describe("rejections", () => {
  it("404s an unknown path", async () => {
    const { call } = build();
    expect((await call("GET", "/parlview/elsewhere")).statusCode).toBe(404);
  });

  it("405s a write to the hearing list", async () => {
    const { call } = build();
    expect((await call("DELETE", "/parlview/api/hearings")).statusCode).toBe(405);
  });
});
