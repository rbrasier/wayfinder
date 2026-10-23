import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createWebhookNotifier } from "./webhook.mjs";

const PERIOD = 5 * 60 * 1000;
const SLOT = 5_000_000;
const at = (slot, offset = 0) => slot * PERIOD + offset;

const build = (target = { url: "http://wayfinder.test/api/triggers/flow-1", token: "wf_wh_abc", hmacSecret: null }) => {
  const posted = [];
  const notifier = createWebhookNotifier({
    target,
    periodMs: PERIOD,
    log: () => {},
    post: async (url, init) => {
      posted.push({ url, ...init, body: init.body });
      return { status: 202 };
    },
  });
  return { notifier, posted };
};

describe("createWebhookNotifier", () => {
  it("treats its first check as a baseline and calls nothing for hearings that already finished", async () => {
    const { notifier, posted } = build();

    await notifier.check(at(SLOT, 1_000));

    expect(posted).toEqual([]);
  });

  it("calls the webhook once for the hearing that finishes at a rollover, with the bearer token", async () => {
    const { notifier, posted } = build();
    await notifier.check(at(SLOT, 1_000));

    await notifier.check(at(SLOT + 1, 1_000));
    await notifier.check(at(SLOT + 1, 2_000));

    expect(posted).toHaveLength(1);
    expect(posted[0].url).toBe("http://wayfinder.test/api/triggers/flow-1");
    expect(posted[0].headers.Authorization).toBe("Bearer wf_wh_abc");
    expect(JSON.parse(posted[0].body).inputs).toMatchObject({ hearing_id: `pv-${SLOT}`, status: "finished" });
  });

  it("calls once per hearing when several finished since the last check", async () => {
    const { notifier, posted } = build();
    await notifier.check(at(SLOT, 1_000));

    await notifier.check(at(SLOT + 3, 1_000));

    expect(posted.map((call) => JSON.parse(call.body).inputs.hearing_id)).toEqual([
      `pv-${SLOT}`,
      `pv-${SLOT + 1}`,
      `pv-${SLOT + 2}`,
    ]);
  });

  it("signs the body the way Wayfinder checks it when an HMAC secret is set", async () => {
    const { notifier, posted } = build({ url: "http://wayfinder.test/hook", token: "t", hmacSecret: "s3cret" });
    await notifier.check(at(SLOT, 1_000));
    await notifier.check(at(SLOT + 1, 1_000));

    const expected = `sha256=${createHmac("sha256", "s3cret").update(posted[0].body).digest("hex")}`;
    expect(posted[0].headers["X-Wayfinder-Signature"]).toBe(expected);
  });

  it("calls nothing while no webhook is set, and does not catch up once one is", async () => {
    const { notifier, posted } = build(null);
    await notifier.check(at(SLOT, 1_000));
    await notifier.check(at(SLOT + 1, 1_000));

    notifier.setTarget({ url: "http://wayfinder.test/hook", token: "t", hmacSecret: null });
    await notifier.check(at(SLOT + 1, 2_000));

    expect(posted).toEqual([]);
  });

  it("describes its target without giving away the token or secret", () => {
    const { notifier } = build({ url: "http://wayfinder.test/hook", token: "wf_wh_abc", hmacSecret: "s" });

    expect(notifier.describe()).toEqual({ url: "http://wayfinder.test/hook", hasToken: true, signsWithHmac: true });
  });
});
