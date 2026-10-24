import { describe, expect, it } from "vitest";
import { automationStepRejection, type AutomationStepGuardDependencies } from "./automation-step-guard";

const dependencies = (
  enabledFlags: string[],
  emailAllowedDomains: string[] = [],
): AutomationStepGuardDependencies => ({
  isFeatureEnabledForUser: async (_userId, key) => ({ data: enabledFlags.includes(key) }),
  getAutomationConfig: async () => ({ watchAllowedHosts: [], emailAllowedDomains }),
});

const emailConfig = (email: string) => ({
  recipients: [{ kind: "address", email }],
  subjectTemplate: "S",
  bodyTemplate: "B",
  attachStepIds: [],
});

describe("automationStepRejection", () => {
  it("lets every other step type through untouched", async () => {
    const rejection = await automationStepRejection(dependencies([]), "user-1", false, "conversational", {});

    expect(rejection).toBeNull();
  });

  it("refuses an AI task when its flag is off for the author", async () => {
    const rejection = await automationStepRejection(dependencies([]), "user-1", false, "ai_task", {});

    expect(rejection).toEqual({ code: "FORBIDDEN", message: "AI task steps are not available to you." });
  });

  it("refuses an Email step that sends outside the allowed domains", async () => {
    const rejection = await automationStepRejection(
      dependencies(["email_node"], ["agency.gov.au"]),
      "user-1",
      false,
      "email",
      emailConfig("leak@gmail.com"),
    );

    expect(rejection).toEqual({
      code: "BAD_REQUEST",
      message: "leak@gmail.com is not on an allowed email domain.",
    });
  });

  it("accepts an Email step whose addresses are allowed", async () => {
    const rejection = await automationStepRejection(
      dependencies(["email_node"], ["agency.gov.au"]),
      "user-1",
      false,
      "email",
      emailConfig("team@agency.gov.au"),
    );

    expect(rejection).toBeNull();
  });

  // A half-written step is saved as the author types; only the domain rule is
  // enforced here, completeness is the editor's and the runtime's job.
  it("does not reject an Email step for being incomplete", async () => {
    const rejection = await automationStepRejection(dependencies(["email_node"]), "user-1", false, "email", {
      recipients: [],
      subjectTemplate: "",
      bodyTemplate: "",
      attachStepIds: [],
    });

    expect(rejection).toBeNull();
  });
});
