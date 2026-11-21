import { trpc } from "@/trpc/client";

// The feature flags that decide which step types and step options the canvas
// offers. Extracted from the config page so that file stays under the
// source-size ceiling.
export interface StepFeatureFlags {
  autoNodeEnabled: boolean;
  scheduledNodeEnabled: boolean;
  mcpEnabled: boolean;
  skillsEnabled: boolean;
  aiTaskNodeEnabled: boolean;
  emailNodeEnabled: boolean;
  // A step's own Test entry opens the flow test modal (ADR-048).
  testRunsEnabled: boolean;
}

export function useStepFeatureFlags(): StepFeatureFlags {
  const flags = trpc.featureFlag.isEnabledForMe;
  return {
    autoNodeEnabled: flags.useQuery({ key: "auto_node" }).data ?? false,
    scheduledNodeEnabled: flags.useQuery({ key: "scheduled_node" }).data ?? false,
    mcpEnabled: flags.useQuery({ key: "mcp" }).data ?? false,
    skillsEnabled: flags.useQuery({ key: "skills" }).data ?? false,
    aiTaskNodeEnabled: flags.useQuery({ key: "ai_task_node" }).data ?? false,
    emailNodeEnabled: flags.useQuery({ key: "email_node" }).data ?? false,
    testRunsEnabled: flags.useQuery({ key: "flow_test_runs" }).data ?? false,
  };
}
