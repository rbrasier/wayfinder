// A catch-all SMTP server for local testing: it speaks enough of the protocol
// for nodemailer (EHLO, AUTH PLAIN/LOGIN with any credentials, MAIL, RCPT,
// DATA) and hands each message to `onMessage` instead of delivering it.
// STARTTLS is refused, so clients stay on the plain connection.

import { createServer } from "node:net";

const HOSTNAME = "wayfinder-mock-smtp";

const address = (argument) => /<([^>]*)>/.exec(argument)?.[1] ?? argument.trim();

export const createSmtpServer = ({ onMessage }) =>
  createServer((socket) => {
    let buffered = "";
    let mode = "command";
    let envelope = { from: "", to: [] };
    let dataLines = [];

    const reply = (...lines) => socket.write(lines.map((line) => `${line}\r\n`).join(""));

    const command = (line) => {
      const [verb = "", ...rest] = line.split(" ");
      const argument = rest.join(" ");
      switch (verb.toUpperCase()) {
        case "EHLO":
          return reply(`250-${HOSTNAME}`, "250-AUTH PLAIN LOGIN", "250-8BITMIME", "250 SMTPUTF8");
        case "HELO":
          return reply(`250 ${HOSTNAME}`);
        case "AUTH": {
          const [mechanism = "", initial] = argument.split(" ");
          if (mechanism.toUpperCase() === "PLAIN") {
            if (initial) return reply("235 2.7.0 Accepted");
            mode = "auth-plain";
            return reply("334 ");
          }
          if (mechanism.toUpperCase() === "LOGIN") {
            mode = initial ? "auth-login-password" : "auth-login-username";
            return reply(initial ? "334 UGFzc3dvcmQ6" : "334 VXNlcm5hbWU6");
          }
          return reply("504 5.5.4 Unrecognised authentication type");
        }
        case "MAIL":
          envelope = { from: address(argument.replace(/^FROM:/i, "")), to: [] };
          return reply("250 2.1.0 OK");
        case "RCPT":
          envelope.to.push(address(argument.replace(/^TO:/i, "")));
          return reply("250 2.1.5 OK");
        case "DATA":
          mode = "data";
          dataLines = [];
          return reply("354 End data with <CR><LF>.<CR><LF>");
        case "RSET":
          envelope = { from: "", to: [] };
          return reply("250 2.0.0 OK");
        case "NOOP":
          return reply("250 2.0.0 OK");
        case "STARTTLS":
          return reply("454 4.7.0 TLS not available");
        case "QUIT":
          reply("221 2.0.0 Bye");
          return socket.end();
        default:
          return reply("502 5.5.2 Command not recognised");
      }
    };

    const line = (text) => {
      if (mode === "data") {
        if (text !== ".") {
          // A leading dot is doubled by the client so a lone "." can end DATA.
          dataLines.push(text.startsWith("..") ? text.slice(1) : text);
          return;
        }
        mode = "command";
        onMessage({ envelopeFrom: envelope.from, envelopeTo: envelope.to, raw: dataLines.join("\r\n") });
        return reply("250 2.0.0 Queued");
      }
      if (mode === "auth-plain" || mode === "auth-login-password") {
        mode = "command";
        return reply("235 2.7.0 Accepted");
      }
      if (mode === "auth-login-username") {
        mode = "auth-login-password";
        return reply("334 UGFzc3dvcmQ6");
      }
      command(text);
    };

    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buffered += chunk;
      let newline = buffered.indexOf("\r\n");
      while (newline !== -1) {
        line(buffered.slice(0, newline));
        buffered = buffered.slice(newline + 2);
        newline = buffered.indexOf("\r\n");
      }
    });
    socket.on("error", () => socket.destroy());
    reply(`220 ${HOSTNAME} ESMTP mock — mail is caught, never delivered`);
  });
