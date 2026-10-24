import { describe, expect, it } from "vitest";
import { emailSentFromFields } from "./email-sent";

describe("emailSentFromFields", () => {
  it("reads the recipients, subject and message an Email step recorded", () => {
    expect(
      emailSentFromFields([
        { key: "recipients", value: "a@agency.gov.au, b@agency.gov.au" },
        { key: "subject", value: "Estimates Summary" },
        { key: "message", value: "**Executive Summary**\n\nThe committee met." },
      ]),
    ).toEqual({
      recipients: ["a@agency.gov.au", "b@agency.gov.au"],
      subject: "Estimates Summary",
      message: "**Executive Summary**\n\nThe committee met.",
    });
  });

  it("copes with a record from before the message was kept", () => {
    expect(emailSentFromFields([{ key: "recipients", value: "a@agency.gov.au" }])).toEqual({
      recipients: ["a@agency.gov.au"],
      subject: "",
      message: null,
    });
  });
});
