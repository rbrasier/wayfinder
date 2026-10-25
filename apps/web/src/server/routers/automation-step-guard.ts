import { isEmailAddressAllowed, type AutomationConfig, type EmailRecipient } from "@wayfinder/domain";

export interface AutomationStepGuardDependencies {
  isFeatureEnabledForUser: (
    userId: string,
    key: string,
    isAdmin: boolean,
  ) => Promise<{ data?: boolean; error?: unknown }>;
  getAutomationConfig: () => Promise<AutomationConfig>;
}

export interface AutomationStepRejection {
  code: "FORBIDDEN" | "BAD_REQUEST";
  message: string;
}

const STEP_FLAGS: Record<string, { flag: string; label: string }> = {
  ai_task: { flag: "ai_task_node", label: "AI task" },
  email: { flag: "email_node", label: "Email" },
};

// The server-side half of the AI task and Email editors (ADR-065 §6a): the
// author must hold the step's flag, and an Email step may only name fixed
// addresses on an allowed domain. Null means the save may go ahead.
export const automationStepRejection = async (
  dependencies: AutomationStepGuardDependencies,
  userId: string,
  isAdmin: boolean,
  type: string | undefined,
  config: Record<string, unknown> | undefined,
): Promise<AutomationStepRejection | null> => {
  const step = type ? STEP_FLAGS[type] : undefined;
  if (!step) return null;

  const enabled = await dependencies.isFeatureEnabledForUser(userId, step.flag, isAdmin);
  if (enabled.error || enabled.data !== true) {
    return { code: "FORBIDDEN", message: `${step.label} steps are not available to you.` };
  }
  if (type !== "email" || !config) return null;

  const { emailAllowedDomains } = await dependencies.getAutomationConfig();
  const recipients = Array.isArray(config.recipients) ? (config.recipients as EmailRecipient[]) : [];
  const blocked = recipients.find(
    (recipient) => recipient.kind === "address" && !isEmailAddressAllowed(recipient.email, emailAllowedDomains),
  );
  if (!blocked || blocked.kind !== "address") return null;
  return { code: "BAD_REQUEST", message: `${blocked.email} is not on an allowed email domain.` };
};
