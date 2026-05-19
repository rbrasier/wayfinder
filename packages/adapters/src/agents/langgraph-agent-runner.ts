import {
  domainError,
  err,
  ok,
  type AgentInput,
  type AgentOutput,
  type AgentRunConfig,
  type IAgentRunner,
  type ILanguageModel,
  type Result,
} from "@rbrasier/domain";
import { END, START, StateGraph, Annotation } from "@langchain/langgraph";

const AgentState = Annotation.Root({
  prompt: Annotation<string>(),
  output: Annotation<string>(),
  steps: Annotation<{ node: string; summary: string }[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
});

/**
 * A minimal single-node LangGraph runner. The node calls the language model
 * once and returns the text. Replace `passthroughNode` (or add nodes / edges)
 * to build real multi-step agents — the IAgentRunner contract does not change.
 */
export class LangGraphAgentRunner implements IAgentRunner {
  private readonly graph;

  constructor(private readonly llm: ILanguageModel) {
    const passthroughNode = async (state: typeof AgentState.State) => {
      const stream = await this.llm.streamText({
        purpose: "agent",
        prompt: state.prompt,
        system: "You are a helpful assistant.",
      });
      if (stream.error) throw new Error(stream.error.message);
      let text = "";
      for await (const chunk of stream.data.textStream) text += chunk;
      return {
        output: text,
        steps: [{ node: "passthrough", summary: `Generated ${text.length} chars.` }],
      };
    };

    this.graph = new StateGraph(AgentState)
      .addNode("passthrough", passthroughNode)
      .addEdge(START, "passthrough")
      .addEdge("passthrough", END)
      .compile();
  }

  async run(input: AgentInput, _config?: AgentRunConfig): Promise<Result<AgentOutput>> {
    try {
      const result = await this.graph.invoke({ prompt: input.prompt, output: "", steps: [] });
      return ok({
        output: result.output,
        steps: result.steps,
        metadata: { provider: this.llm.provider },
      });
    } catch (cause) {
      return err(domainError("AGENT_FAILED", "LangGraph run failed.", cause));
    }
  }
}
