import { z } from "zod";
import { AUTOMATION_CONFIG_SETTING_KEY, validateAutomationConfig } from "@rbrasier/domain";
import { adminProcedure, authenticatedProcedure } from "../trpc";
import { toTrpcError } from "../trpc-errors";

// Install-wide limits for unattended automation (ADR-063 §6, ADR-065 §4): the
// private hosts an Event Watch may call and the domains an Email step may send
// to. Kept in its own module so the main settings router stays under the size
// limit.

const hostList = z
  .array(z.string())
  .max(100)
  .transform((entries) => entries.map((entry) => entry.trim().toLowerCase()).filter((entry) => entry.length > 0));

export const automationConfigInputSchema = z
  .object({ watchAllowedHosts: hostList, emailAllowedDomains: hostList })
  .superRefine((config, refinement) => {
    for (const problem of validateAutomationConfig(config)) {
      refinement.addIssue({ code: z.ZodIssueCode.custom, message: problem });
    }
  });

export const automationSettingsProcedures = {
  getAutomation: adminProcedure.query(({ ctx }) => ctx.container.runtimeConfig.getAutomationConfig()),

  setAutomation: adminProcedure.input(automationConfigInputSchema).mutation(async ({ ctx, input }) => {
    const result = await ctx.container.repos.systemSettings.set(
      AUTOMATION_CONFIG_SETTING_KEY,
      JSON.stringify(input),
    );
    if (result.error) throw toTrpcError(result.error);
    ctx.container.runtimeConfig.invalidateAutomation();
    await ctx.container.services.auditLogger.log({
      actorId: ctx.userId,
      action: "settings.automation.updated",
      resourceType: "system_setting",
      resourceId: AUTOMATION_CONFIG_SETTING_KEY,
      metadata: input,
    });
    return { ok: true };
  }),

  // Authenticated rather than admin: the Email step editor checks addresses
  // against the list as the author types. The list is not sensitive.
  getAllowedEmailDomains: authenticatedProcedure.query(
    async ({ ctx }) => (await ctx.container.runtimeConfig.getAutomationConfig()).emailAllowedDomains,
  ),
};
