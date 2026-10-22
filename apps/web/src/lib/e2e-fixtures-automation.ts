import { AUTOMATION_CONFIG_SETTING_KEY } from "@rbrasier/domain";
import type { Container } from "./container";
import { unwrap } from "./e2e-fixtures";

const SEED_AUTOMATION_FLOW_NAME = "E2E SEED Automation Flow";

// A published flow that can be started unattended (ADR-064/065): it declares
// one required trigger input and opens on a conversational step, so a webhook
// or watch run parks there as "Waiting on a person" without calling a model
// for anything but the step's opening message. Also allow-lists the app's own
// host, so a watch in the e2e suite can call the test-only watch source
// (`/api/test/watch-source`) past the SSRF guard.
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

  unwrap(
    await container.useCases.createFlowNode.execute({
      flowId: flow.id,
      type: "conversational",
      name: "Review the hearing",
      positionX: 120,
      positionY: 120,
      config: {
        aiInstruction: "Help the officer review the finished hearing.",
        doneWhen: "The officer has reviewed the hearing.",
        outputType: "unstructured",
      },
    }),
    "create automation node",
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
