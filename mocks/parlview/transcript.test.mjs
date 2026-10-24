import { describe, expect, it } from "vitest";
import { createClock } from "./clock.mjs";
import { mockLinks } from "./mcp.mjs";
import { createParlviewSource } from "./recordings.mjs";
import {
  CAVEAT,
  compileTerm,
  deepLinkTool,
  getRecent,
  getTranscript,
  listLiveBroadcasts,
  searchBroadcasts,
  searchCaptions,
  termParts,
} from "./transcript.mjs";

const PERIOD = 5 * 60 * 1000;
const SLOT = 5_976_000;
const LIVE = String(SLOT);
const FINISHED = String(SLOT - 1);

// Two minutes into the live hearing.
const build = (offsetMs = 120_000) => {
  const clock = createClock(() => SLOT * PERIOD + offsetMs);
  return {
    source: createParlviewSource({ clock, periodMs: PERIOD }),
    now: () => clock.now(),
    links: mockLinks("http://localhost:4001"),
  };
};

describe("listLiveBroadcasts", () => {
  it("returns the live hearing in parlviewMCP's shape", () => {
    const { broadcasts } = listLiveBroadcasts(build());

    expect(broadcasts).toHaveLength(1);
    expect(Object.keys(broadcasts[0])).toEqual(["id", "title", "committee", "group", "pageUrl", "startedAt"]);
    expect(broadcasts[0]).toMatchObject({
      id: LIVE,
      group: "Committees / Senate",
      pageUrl: `http://localhost:4001/parlview/video/${LIVE}`,
    });
  });
});

describe("searchBroadcasts", () => {
  it("filters by every word, and lists each recording's chunks", () => {
    const deps = build();
    const committee = deps.source.details(FINISHED).eventTitle;
    const { recordings } = searchBroadcasts(deps, { query: committee.split(" ").slice(1, 3).join(" ") });

    expect(recordings.map((recording) => recording.id)).toContain(FINISHED);
    const finished = recordings.find((recording) => recording.id === FINISHED);
    expect(finished).toMatchObject({ isLive: false, hasCaptions: true, chunks: [{ chunk: 1 }] });
    expect(searchBroadcasts(deps, {}).recordings[0].chunks[0].to).toBe("live");
  });

  it("notes how many recordings it looked through when the filter leaves fewer than asked", () => {
    expect(searchBroadcasts(build(), { query: "nothing matches this" })).toEqual({
      recordings: [],
      note: "Searched the 9 most recent recordings.",
    });
  });
});

describe("getTranscript", () => {
  it("defaults to the first 30 minutes of speech of a finished recording", () => {
    const result = getTranscript(build(), { videoId: FINISHED });

    expect(result.stream).toMatchObject({ id: FINISHED, isLive: false, status: "ok", chunks: 1 });
    expect(result.stream.coverage).toEqual([expect.objectContaining({ chunk: 1, source: "captions_api", status: "ok" })]);
    expect(result.passages[0].text).toMatch(/^I declare open this hearing of the Senate/);
    expect(result.passages[0].link).toBe(`http://localhost:4001/parlview/video/${FINISHED}?startTime=8`);
    expect(result).toMatchObject({ truncated: false, nextFrom: null, caveat: CAVEAT });
  });

  it("joins caption lines into passages and breaks on the silence between exchanges", () => {
    const { passages } = getTranscript(build(), { videoId: FINISHED });

    expect(passages.length).toBeGreaterThan(5);
    expect(passages.every((passage) => Object.keys(passage).join() === "timecode,startTime,text,link")).toBe(true);
    expect(passages[1].text).toMatch(/\?$/);
  });

  it("takes seconds from the start or Canberra clock times, and pages with nextFrom", () => {
    const deps = build();
    const firstPage = getTranscript(deps, { videoId: FINISHED, from: 0, maxPassages: 2 });
    const secondPage = getTranscript(deps, { videoId: FINISHED, from: firstPage.nextFrom, maxPassages: 2 });
    const wholeRange = getTranscript(deps, { videoId: FINISHED, from: 0, maxPassages: 4 });

    expect(firstPage.truncated).toBe(true);
    expect([...firstPage.passages, ...secondPage.passages]).toEqual(wholeRange.passages);
  });

  it("reads the last 30 minutes up to the live edge of a live recording", () => {
    const result = getTranscript(build(), { videoId: LIVE });

    expect(result.stream).toMatchObject({ isLive: true, to: "live edge", status: "ok" });
    expect(result.passages.length).toBeGreaterThan(0);
  });

  it("says no_speech for a stretch with no captions", () => {
    const result = getTranscript(build(), { videoId: FINISHED, from: 0, to: 5 });

    expect(result.stream).toMatchObject({ status: "no_speech", note: expect.stringContaining("nobody was speaking") });
    expect(result.passages).toEqual([]);
  });

  it("fails the way parlviewMCP does for an unknown recording or a bad time", () => {
    expect(() => getTranscript(build(), { videoId: "12" })).toThrow("No ParlView recording with media found for id 12.");
    expect(() => getTranscript(build(), { videoId: FINISHED, from: "noon" })).toThrow('Invalid time "noon"');
  });
});

describe("getRecent", () => {
  it("returns what was said in the live hearing so far, with the newest caption's time", () => {
    const result = getRecent(build(), { videoId: LIVE, minutes: 5 });

    expect(result.stream).toMatchObject({ isLive: true, status: "ok" });
    expect(result.stream.lastCaption).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(result.passages.length).toBeGreaterThan(0);
  });

  it("says no_captions_yet when the hearing has only just gone live", () => {
    expect(getRecent(build(1_000), { videoId: LIVE }).stream.status).toBe("no_captions_yet");
  });

  it("says not_live for a finished recording", () => {
    expect(getRecent(build(), { videoId: FINISHED })).toMatchObject({
      stream: { status: "not_live", note: expect.stringContaining("get_transcript") },
      passages: [],
    });
  });
});

describe("searchCaptions", () => {
  it("finds terms whole-word across line breaks, with each hit's link and the passages around it", () => {
    const result = searchCaptions(build(), { videoId: FINISHED, terms: ["ANAO", "on notice", "ANA"] });

    expect(result.terms.ANAO).toBeGreaterThan(0);
    expect(result.terms["on notice"]).toBeGreaterThan(0);
    expect(result.terms.ANA).toBe(0);
    expect(result.totalHits).toBe(result.terms.ANAO + result.terms["on notice"]);
    const [firstMatch] = result.matches;
    expect(firstMatch.hits[0].link).toMatch(new RegExp(`/parlview/video/${FINISHED}\\?startTime=\\d+$`));
    expect(firstMatch.passages.length).toBeGreaterThan(0);
  });

  it("matches the way live captions are typed", () => {
    expect(termParts("AirTrunk")).toEqual(["Air", "Trunk"]);
    expect(termParts("ANAOReport")).toEqual(["ANAO", "Report"]);
    expect("an air-trunk site").toMatch(compileTerm("AirTrunk"));
    expect("the ANAOs").not.toMatch(compileTerm("ANAO"));
  });
});

describe("deepLinkTool", () => {
  it("links a moment by Canberra time or seconds from the start", () => {
    const deps = build();
    const bySeconds = deepLinkTool(deps, { videoId: FINISHED, at: 90 });
    const byClock = deepLinkTool(deps, { videoId: FINISHED, at: bySeconds.timecode });

    expect(bySeconds).toEqual({
      url: `http://localhost:4001/parlview/video/${FINISHED}?startTime=90`,
      timecode: bySeconds.timecode,
      startTime: 90,
    });
    expect(byClock).toEqual(bySeconds);
  });

  it("refuses a moment outside the recording", () => {
    expect(() => deepLinkTool(build(), { videoId: FINISHED, at: 3_600 })).toThrow("is outside the recording");
  });
});
