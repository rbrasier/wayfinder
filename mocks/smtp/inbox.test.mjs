import { describe, expect, it } from "vitest";
import { json, request, response } from "../test-support/http.mjs";
import { createInbox, createInboxMock } from "./inbox.mjs";

const received = (subject) => ({
  envelopeFrom: "wayfinder@example.com",
  envelopeTo: ["estimates@agency.gov.au"],
  raw: ["Subject: " + subject, "", "Body of " + subject].join("\r\n"),
});

const build = () => {
  const printed = [];
  const inbox = createInbox({ log: (line) => printed.push(line), limit: 2 });
  const inboxMock = createInboxMock(inbox);
  const call = async (method, url) => {
    const res = response();
    await inboxMock.handle(request(method, url), res);
    return res.recorded;
  };
  return { inbox, inboxMock, call, printed };
};

describe("createInbox", () => {
  it("prints each message to the console as it arrives", () => {
    const { inbox, printed } = build();
    inbox.add(received("First"));

    expect(printed.join("\n")).toContain("First");
  });

  it("keeps only the most recent messages, newest first", () => {
    const { inbox } = build();
    inbox.add(received("First"));
    inbox.add(received("Second"));
    inbox.add(received("Third"));

    expect(inbox.list().map((message) => message.subject)).toEqual(["Third", "Second"]);
  });
});

describe("the /smtp endpoint", () => {
  it("claims the /smtp path", () => {
    expect(build().inboxMock.path).toBe("/smtp");
  });

  it("lists caught messages without their raw source", async () => {
    const { inbox, call } = build();
    inbox.add(received("First"));

    const body = json(await call("GET", "/smtp/messages"));

    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].subject).toBe("First");
    expect(body.messages[0]).not.toHaveProperty("raw");
  });

  it("returns one message in full by id", async () => {
    const { inbox, call } = build();
    const { id } = inbox.add(received("First"));

    const recorded = await call("GET", `/smtp/messages/${id}`);

    expect(recorded.statusCode).toBe(200);
    expect(json(recorded).raw).toContain("Body of First");
  });

  it("empties the inbox", async () => {
    const { inbox, call } = build();
    inbox.add(received("First"));

    expect((await call("DELETE", "/smtp/messages")).statusCode).toBe(200);
    expect(inbox.list()).toEqual([]);
  });

  it("explains how to point Wayfinder at it", async () => {
    const { call } = build();
    const recorded = await call("GET", "/smtp");

    expect(recorded.body).toContain("2525");
    expect(recorded.body).toContain("Email");
  });
});
