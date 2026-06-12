import { z } from "zod";

// The position descriptor extracted from delegation policy text during dynamic
// approver resolution. Every field is optional — the policy may name only a role,
// or a role and a band, etc. An all-empty result signals "nothing extracted" so
// the caller falls back to the node's roleHint.
export const delegationPositionSchema = z.object({
  role: z
    .string()
    .optional()
    .describe("The named position or role that holds the delegated approval authority."),
  band: z.string().optional().describe("The pay band or grade tied to the authority, if stated."),
  businessUnit: z
    .string()
    .optional()
    .describe("The business unit, division, or department the authority sits within, if stated."),
});

export type DelegationPosition = z.infer<typeof delegationPositionSchema>;
