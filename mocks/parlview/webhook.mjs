// Calls a Wayfinder flow's webhook (ADR-064) each time a mock hearing finishes,
// so "start a flow from another system" can be driven by the same hearings an
// Event Watch sees. Set it with PARLVIEW_MOCK_WEBHOOK_URL / _TOKEN /
// _HMAC_SECRET, or at runtime through POST /parlview/api/webhook.
//
// The body is `{ inputs: {...} }` with every hearing field a flow might declare;
// Wayfinder keeps the declared ones and drops the rest. The first check is a
// baseline, like a watch's, so turning the mock on never replays old hearings.

import { createHmac } from "node:crypto";
import { recordingById, vodapiVideo } from "./recordings.mjs";

export const targetFromEnv = () => {
  const url = process.env.PARLVIEW_MOCK_WEBHOOK_URL;
  if (!url) return null;
  return {
    url,
    token: process.env.PARLVIEW_MOCK_WEBHOOK_TOKEN ?? "",
    hmacSecret: process.env.PARLVIEW_MOCK_WEBHOOK_HMAC_SECRET || null,
  };
};

// The finished recording's vodapi fields, under names a flow would declare.
const inputsFor = (recording) => {
  const video = vodapiVideo(recording);
  return {
    hearing_id: video.parlViewId,
    title: video.parlViewTitle,
    committee: video.eventTitle,
    status: "finished",
    recorded_from: video.recordingFrom,
    recorded_to: video.recordingTo,
  };
};

export const createWebhookNotifier = ({ target = null, periodMs, post = fetch, log = console.log }) => {
  let current = target;
  let lastSlot = null;

  const deliver = async (recording) => {
    const body = JSON.stringify({ inputs: inputsFor(recording) });
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${current.token}` };
    if (current.hmacSecret) {
      headers["X-Wayfinder-Signature"] = `sha256=${createHmac("sha256", current.hmacSecret).update(body).digest("hex")}`;
    }
    try {
      const response = await post(current.url, { method: "POST", headers, body });
      log(`[mocks] parlview → webhook ${recording.id} finished: HTTP ${response.status}`);
    } catch (cause) {
      log(`[mocks] parlview → webhook ${recording.id} failed: ${cause instanceof Error ? cause.message : cause}`);
    }
  };

  const check = async (nowMs) => {
    const slot = Math.floor(nowMs / periodMs);
    const previous = lastSlot;
    lastSlot = slot;
    if (previous === null || slot <= previous || !current) return;
    // The recording in each slot that has closed since the last check has finished.
    for (let finishedSlot = previous; finishedSlot < slot; finishedSlot += 1) {
      await deliver(recordingById(String(finishedSlot), nowMs, { periodMs }));
    }
  };

  return {
    check,
    setTarget: (next) => {
      current = next;
    },
    describe: () =>
      current ? { url: current.url, hasToken: Boolean(current.token), signsWithHmac: Boolean(current.hmacSecret) } : null,
  };
};
