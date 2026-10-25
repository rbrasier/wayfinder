import { connect } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createInbox } from "./inbox.mjs";
import { createSmtpServer } from "./server.mjs";

// Drives the server the way a mail client does: send a line, wait for the
// reply that line earns. Replies are read until a final "NNN " line.
const conversation = async (port) => {
  const socket = connect(port, "127.0.0.1");
  let buffered = "";
  const waiters = [];
  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    buffered += chunk;
    while (waiters.length > 0) {
      const finalLine = buffered.split("\r\n").find((line) => /^\d{3} /.test(line));
      if (!finalLine) return;
      const end = buffered.indexOf(finalLine) + finalLine.length + 2;
      const reply = buffered.slice(0, end);
      buffered = buffered.slice(end);
      waiters.shift()(reply);
    }
  });
  const nextReply = () => new Promise((resolve) => waiters.push(resolve));
  const send = (line) => {
    const reply = nextReply();
    socket.write(`${line}\r\n`);
    return reply;
  };
  return { greeting: nextReply(), send, close: () => socket.destroy() };
};

const servers = [];
const start = async () => {
  const inbox = createInbox({ log: () => {} });
  const server = createSmtpServer({ onMessage: inbox.add });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  return { inbox, port: server.address().port };
};

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

describe("createSmtpServer", () => {
  it("accepts any login and keeps the message it is sent", async () => {
    const { inbox, port } = await start();
    const client = await conversation(port);

    expect(await client.greeting).toMatch(/^220 /);
    expect(await client.send("EHLO test")).toContain("AUTH PLAIN LOGIN");
    const credentials = Buffer.from("\0mock\0anything").toString("base64");
    expect(await client.send(`AUTH PLAIN ${credentials}`)).toMatch(/^235 /);
    expect(await client.send("MAIL FROM:<wayfinder@example.com>")).toMatch(/^250 /);
    expect(await client.send("RCPT TO:<estimates@agency.gov.au>")).toMatch(/^250 /);
    expect(await client.send("DATA")).toMatch(/^354 /);
    const accepted = await client.send(
      ["Subject: Hearing summary", "", "The committee met.", "..A line that began with a dot.", "."].join("\r\n"),
    );
    expect(accepted).toMatch(/^250 /);
    expect(await client.send("QUIT")).toMatch(/^221 /);
    client.close();

    const [message] = inbox.list();
    expect(message).toMatchObject({
      envelopeFrom: "wayfinder@example.com",
      envelopeTo: ["estimates@agency.gov.au"],
      subject: "Hearing summary",
      text: "The committee met.\n.A line that began with a dot.",
    });
  });

  it("walks the two-step AUTH LOGIN exchange", async () => {
    const { port } = await start();
    const client = await conversation(port);
    await client.greeting;
    await client.send("EHLO test");

    expect(await client.send("AUTH LOGIN")).toMatch(/^334 /);
    expect(await client.send(Buffer.from("mock").toString("base64"))).toMatch(/^334 /);
    expect(await client.send(Buffer.from("secret").toString("base64"))).toMatch(/^235 /);
    client.close();
  });

  it("refuses STARTTLS so a client stays on the plain connection", async () => {
    const { port } = await start();
    const client = await conversation(port);
    await client.greeting;

    expect(await client.send("STARTTLS")).toMatch(/^454 /);
    client.close();
  });
});
