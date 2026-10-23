import { AUTOMATION_CONFIG_SETTING_KEY } from "@rbrasier/domain";
import type { Container } from "./container";
import { unwrap } from "./e2e-fixtures";

const SEED_AUTOMATION_FLOW_NAME = "E2E SEED Automation Flow";

// A published flow that can be started unattended (ADR-064/065): it declares
// one required trigger input, opens on an AI task step, then parks on a
// conversational step as "Waiting on a person". The AI task's threshold is 0:
// its confidence field declares no range, so the unscripted model answers the
// smallest value (1), and any higher threshold would park the run on review
// with its output card hidden. Also allow-lists the
// app's own host, so a watch in the e2e suite can call the test-only watch
// source (`/api/test/watch-source`) past the SSRF guard.
export const seedAutomationFlow = async (container: Container, ownerUserId: string): Promise<string> => {
  const flow = unwrap(
    await container.useCases.createFlow.execute({
      name: SEED_AUTOMATION_FLOW_NAME,
      description: "Seeded flow started by webhooks and Event Watches",
      expertRole: "Estimates Officer",
      ownerUserId,
    }),
    "create automation flow",
  );

  const aiTaskNode = unwrap(
    await container.useCases.createFlowNode.execute({
      flowId: flow.id,
      type: "ai_task",
      name: "Summarise the hearing",
      positionX: 120,
      positionY: 120,
      config: {
        instruction: "Summarise the finished hearing in two sentences.",
        outputType: "structured",
        structuredFields: [{ key: "summary", label: "Summary", type: "narrative" }],
        confidenceThreshold: 0,
        reviewer: { mode: "run_owner" },
      },
    }),
    "create automation AI task node",
  );

  const reviewNode = unwrap(
    await container.useCases.createFlowNode.execute({
      flowId: flow.id,
      type: "conversational",
      name: "Review the hearing",
      positionX: 120,
      positionY: 320,
      config: {
        aiInstruction: "Help the officer review the finished hearing.",
        doneWhen: "The officer has reviewed the hearing.",
        outputType: "unstructured",
      },
    }),
    "create automation node",
  );

  unwrap(
    await container.useCases.createFlowEdge.execute({
      flowId: flow.id,
      fromNodeId: aiTaskNode.id,
      toNodeId: reviewNode.id,
    }),
    "connect automation nodes",
  );

  unwrap(
    await container.repos.flows.update(flow.id, {
      triggerInputs: [{ key: "hearing_id", label: "Hearing", type: "text", required: true }],
    }),
    "declare automation trigger inputs",
  );

  unwrap(
    await container.useCases.updateFlow.execute(
      flow.id,
      { status: "published", visibility: { kind: "global" } },
      { canPublishToEveryone: true },
    ),
    "publish automation flow",
  );

  const appHost = new URL(container.env.BETTER_AUTH_URL).hostname;
  unwrap(
    await container.repos.systemSettings.set(
      AUTOMATION_CONFIG_SETTING_KEY,
      JSON.stringify({ watchAllowedHosts: [appHost], emailAllowedDomains: [] }),
    ),
    "allow-list the app host for event watches",
  );
  container.runtimeConfig.invalidateAutomation();

  return flow.id;
};
