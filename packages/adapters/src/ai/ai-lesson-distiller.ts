import {
  ok,
  type ILanguageModel,
  type ILessonDistiller,
  type LessonCandidate,
  type LessonDistillationRequest,
  type ObservationDetail,
  type Result,
} from "@wayfinder/domain";
import { z } from "zod";

// A statement long enough to be a rule and short enough to sit in a prompt
// without crowding out the author's own instructions.
const MAX_STATEMENT_LENGTH = 300;
const MAX_CANDIDATES = 3;

const candidatesSchema = z.object({
  candidates: z
    .array(
      z.object({
        statement: z.string(),
        supersedesStatement: z.string().nullable().optional(),
      }),
    )
    .max(MAX_CANDIDATES),
});

const SYSTEM_PROMPT = [
  "You turn observations about one step of one workflow into at most three short,",
  "general rules that would make that step work better next time.",
  "Each rule must be a single sentence, in the imperative, addressed to the AI that runs the step.",
  "Write a general rule, never a restatement of what happened.",
  "NEVER repeat a specific value seen in a session — no names, numbers, dates, amounts",
  "or identifiers taken from the observations. A rule that names a value is wrong and will be rejected.",
  "If the observations do not support a general rule, return an empty list.",
  "If an existing accepted rule already covers the point, either return nothing or",
  "propose a clearer replacement and name the rule it replaces in supersedesStatement.",
].join(" ");

// The session-derived values a statement must not restate. Deliberately not a
// blind walk of the payload: field keys and the kind discriminator are authoring
// vocabulary, already visible to the model, and treating them as leaks rejects
// perfectly good rules for using the word "supplier".
const leakableValues = (detail: ObservationDetail): string[] => {
  switch (detail.kind) {
    case "field_corrected":
      return detail.corrections.flatMap((correction) => [
        correction.previousValue,
        correction.newValue,
      ]);
    case "change_requested":
      return detail.comments;
    case "knowledge_gap":
      return detail.missingInformation;
    case "redundant_question":
      return detail.questions.map((question) => question.question);
    // The remaining kinds carry only counts and confidences, which cannot
    // identify anything.
    default:
      return [];
  }
};

// Below this, a value is as likely to be an ordinary English word as a leak, and
// rejecting on it costs more good rules than it saves bad ones.
const MIN_LEAKABLE_LENGTH = 5;

// The mechanical half of the leak defence adopted at /doc-review. The prompt
// instructs the model not to restate a value; this rejects it when it does
// anyway. A paraphrase, or a value shorter than the bound, still gets through —
// which is what the accept gate is for. This makes the common case mechanical,
// not the whole problem solved.
const restatesAVerbatimValue = (statement: string, values: string[]): boolean => {
  const haystack = statement.toLowerCase();

  return values.some((value) => {
    const needle = value.trim().toLowerCase();
    if (needle.length < MIN_LEAKABLE_LENGTH) return false;
    return haystack.includes(needle);
  });
};

export class AiLessonDistiller implements ILessonDistiller {
  constructor(private readonly languageModel: ILanguageModel) {}

  async distil(
    request: LessonDistillationRequest,
  ): Promise<Result<{ candidates: LessonCandidate[] }>> {
    const prompt = [
      `Step name: ${request.nodeName}`,
      `What the step is instructed to do: ${request.nodeInstruction}`,
      `Signal type: ${request.kind}`,
      `Observations (${request.observations.length}):`,
      JSON.stringify(request.observations.map((observation) => observation.detail)),
      request.existingStatements.length > 0
        ? `Rules already accepted on this step: ${JSON.stringify(request.existingStatements)}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const result = await this.languageModel.generateObject<z.infer<typeof candidatesSchema>>({
      purpose: "flow-lesson-distillation",
      flowId: request.flowId,
      system: SYSTEM_PROMPT,
      prompt,
      schema: candidatesSchema,
    });
    if (result.error) return result;

    return ok({ candidates: this.sanitise(request, result.data.object) });
  }

  // Output is sanitised before it leaves the adapter, so a malformed or leaky
  // candidate never reaches the use case, let alone the database.
  private sanitise(
    request: LessonDistillationRequest,
    raw: z.infer<typeof candidatesSchema>,
  ): LessonCandidate[] {
    const values = request.observations.flatMap((observation) =>
      leakableValues(observation.detail),
    );

    return raw.candidates
      .map((candidate) => candidate.statement.trim())
      .filter((statement) => statement.length > 0 && statement.length <= MAX_STATEMENT_LENGTH)
      .filter((statement) => !restatesAVerbatimValue(statement, values))
      .slice(0, MAX_CANDIDATES)
      .map((statement) => ({
        // The node and kind come from the request, never from the model: a
        // candidate cannot name a step it was not asked about.
        nodeId: request.nodeId,
        kind: request.kind,
        statement,
      }));
  }
}
