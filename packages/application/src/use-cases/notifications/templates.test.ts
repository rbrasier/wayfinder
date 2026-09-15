import { describe, expect, it } from "vitest";
import {
  buildFlowSharedEmail,
  buildPasswordResetEmail,
  buildSessionCompleteEmail,
} from "./templates";

describe("buildSessionCompleteEmail", () => {
  it("names the flow in the subject and links to the session", () => {
    const email = buildSessionCompleteEmail({
      flowName: "Procurement Plan",
      sessionTitle: "Q3 laptops",
      sessionUrl: "https://wayfinder.example/chats/session-1",
    });

    expect(email.subject).toBe("Your 'Procurement Plan' session is complete");
    expect(email.text).toContain("Q3 laptops");
    expect(email.text).toContain("https://wayfinder.example/chats/session-1");
    expect(email.html).toContain('href="https://wayfinder.example/chats/session-1"');
  });

  it("falls back to the flow name when the session has no title", () => {
    const email = buildSessionCompleteEmail({
      flowName: "Procurement Plan",
      sessionTitle: null,
      sessionUrl: "https://wayfinder.example/chats/session-1",
    });

    expect(email.text).toContain("Procurement Plan");
  });

  it("escapes HTML in user-controlled names", () => {
    const email = buildSessionCompleteEmail({
      flowName: "<script>alert(1)</script>",
      sessionTitle: "a & b",
      sessionUrl: "https://wayfinder.example/chats/session-1",
    });

    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).toContain("a &amp; b");
  });
});

describe("buildFlowSharedEmail", () => {
  it("names the granter, flow, and role, and links to the flow", () => {
    const email = buildFlowSharedEmail({
      flowName: "Procurement Plan",
      granterName: "Alice",
      role: "owner",
      flowUrl: "https://wayfinder.example/admin/flows/flow-1",
    });

    expect(email.subject).toBe("Alice shared the 'Procurement Plan' flow with you");
    expect(email.text).toContain("owner");
    expect(email.text).toContain("https://wayfinder.example/admin/flows/flow-1");
    expect(email.html).toContain('href="https://wayfinder.example/admin/flows/flow-1"');
  });

  it("uses a neutral granter name when none is known", () => {
    const email = buildFlowSharedEmail({
      flowName: "Procurement Plan",
      granterName: null,
      role: "viewer",
      flowUrl: "https://wayfinder.example/admin/flows/flow-1",
    });

    expect(email.subject).toBe("Someone shared the 'Procurement Plan' flow with you");
  });

  it("escapes HTML in user-controlled names", () => {
    const email = buildFlowSharedEmail({
      flowName: "Plan <b>",
      granterName: "Eve & co",
      role: "viewer",
      flowUrl: "https://wayfinder.example/admin/flows/flow-1",
    });

    expect(email.html).toContain("Plan &lt;b&gt;");
    expect(email.html).toContain("Eve &amp; co");
  });
});

describe("buildPasswordResetEmail", () => {
  const input = {
    recipientName: "Ada Lovelace",
    resetUrl: "https://wayfinder.example/reset-password?token=abc123",
    expiryMinutes: 60,
  };

  it("greets the recipient by name and links to the reset page", () => {
    const email = buildPasswordResetEmail(input);

    expect(email.subject).toBe("Reset your Wayfinder password");
    expect(email.text).toContain("Hello Ada Lovelace,");
    expect(email.text).toContain(input.resetUrl);
    expect(email.html).toContain(`href="${input.resetUrl}"`);
  });

  it("falls back to a plain greeting when the account has no name", () => {
    const email = buildPasswordResetEmail({ ...input, recipientName: null });

    expect(email.text).toContain("Hello,");
    expect(email.text).not.toContain("null");
    expect(email.html).not.toContain("null");
  });

  it("states the expiry so the reader can judge a stale link", () => {
    const email = buildPasswordResetEmail({ ...input, expiryMinutes: 30 });

    expect(email.text).toContain("expires in 30 minutes");
    expect(email.html).toContain("expires in 30 minutes");
  });

  // A reset the recipient did not ask for is the phishing-shaped case; the mail
  // has to say plainly that ignoring it is safe.
  it("tells a recipient who did not request it that they need do nothing", () => {
    const email = buildPasswordResetEmail(input);

    expect(email.text).toContain("did not ask to reset your password");
    expect(email.html).toContain("did not ask to reset your password");
  });

  it("never includes the raw token outside the link", () => {
    const email = buildPasswordResetEmail(input);

    expect(email.text.split(input.resetUrl).join("")).not.toContain("abc123");
  });

  it("escapes HTML in the recipient name", () => {
    const email = buildPasswordResetEmail({ ...input, recipientName: "Eve <b> & co" });

    expect(email.html).toContain("Eve &lt;b&gt; &amp; co");
  });
});
