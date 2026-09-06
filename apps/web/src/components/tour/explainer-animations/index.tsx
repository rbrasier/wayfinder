import type { ExplainerCardId } from "../flow-explainer-cards";
import { ConversationAnimation } from "./conversation-animation";
import { DoneWhenAnimation } from "./done-when-animation";
import { PublishAnimation } from "./publish-animation";
import { RulesAnimation } from "./rules-animation";
import { StepsAnimation } from "./steps-animation";
import { TemplateAnimation } from "./template-animation";

const ANIMATIONS: Record<ExplainerCardId, () => React.JSX.Element> = {
  conversation: ConversationAnimation,
  steps: StepsAnimation,
  "done-when": DoneWhenAnimation,
  template: TemplateAnimation,
  rules: RulesAnimation,
  publish: PublishAnimation,
};

export function ExplainerAnimation({ cardId }: { cardId: ExplainerCardId }) {
  const Animation = ANIMATIONS[cardId];
  return <Animation />;
}
