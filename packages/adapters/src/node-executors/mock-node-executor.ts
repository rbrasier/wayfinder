import type {
  INodeExecutor,
  NodeExecutionInput,
  NodeExecutionOutput,
  Result,
} from "@rbrasier/domain";

export class MockNodeExecutor implements INodeExecutor {
  async execute(input: NodeExecutionInput): Promise<Result<NodeExecutionOutput>> {
    return {
      data: {
        status: "completed",
        data: {
          nodeId: input.nodeId,
          sessionId: input.sessionId,
          userId: input.userId,
          processed: true,
        },
        message: `Node ${input.nodeId} executed (mock).`,
      },
    };
  }
}
