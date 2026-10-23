// What the ParlView tools on the mock MCP server answer, kept apart from the MCP
// wiring so it can be tested directly. They let an AI task step look a hearing
// up the way a ParlView MCP server would: list hearings, then read one
// transcript by the id a watch or webhook passed in.

import { hearingById, hearingsAt } from "./hearings.mjs";

export const hearingListText = (nowMs, periodMs, status) =>
  hearingsAt(nowMs, { periodMs })
    .filter((hearing) => !status || hearing.status === status)
    .map((hearing) => `${hearing.id} [${hearing.status}] ${hearing.title} — ${hearing.committee}`)
    .join("\n");

export const transcriptText = (id, nowMs, periodMs) => {
  const hearing = hearingById(id, nowMs, { periodMs });
  if (!hearing) return { isError: true, text: `No hearing with id ${id}.` };
  if (hearing.status === "scheduled") {
    return { isError: true, text: `${id} has not started, so there is no transcript yet.` };
  }
  return {
    isError: false,
    text: [`${hearing.title} — ${hearing.committee} (${hearing.status})`, "", hearing.transcript].join("\n"),
  };
};
