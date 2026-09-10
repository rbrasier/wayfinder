import { doneWhenGuidance, nodeFieldSet, type ConversationalNodeConfig } from "@wayfinder/domain";

// How much conversation tail the message query may carry. Long enough that a
// thin reply ("Joe Bloggs, are there any options?") inherits the subject of the
// turns around it, short enough that an embedding of it still points somewhere
// specific — a whole transcript embeds to the average of everything discussed,
// which matches nothing in particular.
const MAX_TAIL_TURNS = 6;
const MAX_QUERY_CHARS = 2000;

export interface TurnRetrievalMessage {
  role: string;
  content: string;
}

export interface BuildTurnRetrievalQueriesInput {
  // Partial because callers hold stored config, and a node authored before a
  // field existed simply lacks it.
  nodeConfig: Partial<ConversationalNodeConfig>;
  // Oldest first, as the feed and the model see them.
  recentMessages: readonly TurnRetrievalMessage[];
  latestUserMessage: string;
}

// Keeps the newest content when the tail is too long: the last thing said is
// the most likely to describe what the turn is about.
const trimToBudget = (value: string): string =>
  value.length <= MAX_QUERY_CHARS ? value : value.slice(value.length - MAX_QUERY_CHARS);

// What the operator and assistant have just been talking about. System rows are
// excluded: a cross-check note or a scheduling notice is the system describing
// the conversation, not content of it, and embedding it pulls retrieval towards
// the machinery instead of the subject.
const buildMessageQuery = (input: BuildTurnRetrievalQueriesInput): string | null => {
  const tail = input.recentMessages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-MAX_TAIL_TURNS)
    .map((message) => message.content.trim())
    .filter((content) => content.length > 0);

  const latest = input.latestUserMessage.trim();
  // The latest message is usually already the last row of the tail; include it
  // only when it is not, so a turn is never embedded with its own text twice.
  const parts = latest.length > 0 && tail.at(-1) !== latest ? [...tail, latest] : tail;
  if (parts.length === 0) return null;

  return trimToBudget(parts.join("\n"));
};

// What this step is *for*, in the flow author's own words. Stable for the whole
// step, so it retrieves the same guidance on every turn — including the opening
// turn, which has no user message to retrieve against at all. This is the query
// that reaches a policy clause the operator has not thought to ask about.
const buildStepQuery = (nodeConfig: Partial<ConversationalNodeConfig>): string | null => {
  // nodeFieldSet reads only these three; the two required prose fields are
  // supplied empty rather than spread, so a config that explicitly carries
  // `outputType: undefined` still resolves to the unstructured default.
  const fieldLabels = nodeFieldSet({
    aiInstruction: "",
    doneWhen: "",
    outputType: nodeConfig.outputType ?? "unstructured",
    documentTemplateFields: nodeConfig.documentTemplateFields ?? null,
    structuredFields: nodeConfig.structuredFields ?? null,
  })
    .map((field) => field.label.trim())
    .filter((label) => label.length > 0);

  const parts = [
    nodeConfig.aiInstruction?.trim(),
    doneWhenGuidance(nodeConfig.doneWhen),
    ...fieldLabels,
  ].filter((part): part is string => Boolean(part && part.length > 0));

  if (parts.length === 0) return null;
  return trimToBudget(parts.join("\n"));
};

// The retrieval keys for one conversational turn (ADR-016 Decision 5, revised).
// Two queries rather than one: what is being said, and what the step is about.
// Returned message-query-first so the caller's merge leads with the turn's own
// subject when both score equally. De-duplicated, so an operator echoing the
// step instruction costs one embedding call rather than two.
export const buildTurnRetrievalQueries = (
  input: BuildTurnRetrievalQueriesInput,
): string[] => {
  const queries = [buildMessageQuery(input), buildStepQuery(input.nodeConfig)].filter(
    (query): query is string => query !== null,
  );
  return [...new Set(queries)];
};
