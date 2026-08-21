import {
  formatValueSetEntry,
  ok,
  rankValueSetCandidates,
  SHORTLIST_ENTRY_BUDGET,
  type ILanguageModel,
  type IValueSetShortlister,
  type Result,
  type ValueSetCandidate,
  type ValueSetEntry,
  type ValueSetShortlistInput,
} from "@rbrasier/domain";
import { z } from "zod";

// Ranked candidates are scored below an exact or normalised string match and
// above the fuzzy floor, so a merged list keeps the model's ordering without
// ever outranking a value the letters already settled.
const TOP_SCORE = 0.9;
const SCORE_STEP = 0.05;

const shortlistSchema = z.object({
  rationale: z.string(),
  choices: z.array(z.object({ key: z.string(), display: z.string() })),
});

const SYSTEM_PROMPT = [
  "You match what someone typed to entries in a fixed reference list.",
  "They may use a different word for the same thing — a team called Finance may",
  "be the one that handles procurement — so judge by what the entry is for, not",
  "by spelling. Return only entries that appear in the list you are given, most",
  "likely first, and return none at all if nothing in the list plausibly fits.",
].join(" ");

// Reaches the entries that share no letters with what someone typed. A single
// bounded generateObject call in the shape of the branch decision: the options
// go into the prompt, the model ranks them, and anything it returns that is not
// in the list is discarded (ADR-051 §3).
export class AiValueSetShortlister implements IValueSetShortlister {
  constructor(
    private readonly languageModel: ILanguageModel,
    private readonly budget: number = SHORTLIST_ENTRY_BUDGET,
  ) {}

  async shortlist(input: ValueSetShortlistInput): Promise<Result<ValueSetCandidate[]>> {
    if (input.entries.length === 0) return ok([]);

    const budget = input.budget && input.budget > 0 ? input.budget : this.budget;
    const offered = sampleForShortlist(input.entries, input.query, budget);
    const result = await this.languageModel.generateObject({
      purpose: "value-set-shortlist",
      system: SYSTEM_PROMPT,
      prompt: buildPrompt(input, offered),
      schema: shortlistSchema,
    });
    // Narrowing is an improvement on a block, never a reason for one: a model
    // outage leaves the operator with the string ladder's answer.
    if (result.error) return ok([]);

    return ok(toCandidates(readChoices(result.data.object), offered, input.limit));
  }
}

const buildPrompt = (input: ValueSetShortlistInput, entries: ValueSetEntry[]): string => {
  const list = entries.map((entry) => `- ${formatValueSetEntry(entry)}`).join("\n");
  const field = input.fieldLabel ? `\nIt was entered for the field: ${input.fieldLabel}` : "";

  return `Someone entered: "${input.query}"${field}

Entries to choose from:
${list}

Give at most ${input.limit} entries from that list, most likely first. For each, give its key exactly as shown in the brackets — or an empty string where an entry has none — and its display text exactly as shown.`;
};

interface ModelChoice {
  readonly key?: string;
  readonly display?: string;
}

// The stored object is whatever the provider returned. It has passed the schema
// in production, but a shortlist is optional help, so a shape that surprises us
// yields no candidates rather than throwing into the step-end check.
const readChoices = (object: unknown): ModelChoice[] => {
  if (!object || typeof object !== "object") return [];
  const choices = (object as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return [];

  return choices
    .filter((choice): choice is Record<string, unknown> => !!choice && typeof choice === "object")
    .map((choice) => ({
      ...(typeof choice.key === "string" ? { key: choice.key } : {}),
      ...(typeof choice.display === "string" ? { display: choice.display } : {}),
    }));
};

// A returned option only counts if it is genuinely in the set. Without this a
// model that invented a plausible-sounding department would put a value in front
// of the operator that no source has ever held.
const toCandidates = (
  choices: ModelChoice[],
  entries: ValueSetEntry[],
  limit: number,
): ValueSetCandidate[] => {
  const byKey = new Map<string, ValueSetEntry>();
  const byDisplay = new Map<string, ValueSetEntry>();
  entries.forEach((entry) => {
    if (entry.key) byKey.set(entry.key.toLowerCase(), entry);
    byDisplay.set(entry.display.toLowerCase(), entry);
  });

  const seen = new Set<ValueSetEntry>();
  const candidates: ValueSetCandidate[] = [];

  for (const choice of choices) {
    if (candidates.length >= limit) break;

    const entry = matchChoice(choice, byKey, byDisplay);
    if (!entry || seen.has(entry)) continue;

    seen.add(entry);
    candidates.push({ entry, score: TOP_SCORE - candidates.length * SCORE_STEP, tier: "inferred" });
  }

  return candidates;
};

const matchChoice = (
  choice: ModelChoice,
  byKey: Map<string, ValueSetEntry>,
  byDisplay: Map<string, ValueSetEntry>,
): ValueSetEntry | undefined => {
  const key = choice.key?.trim().toLowerCase();
  if (key) return byKey.get(key);

  const display = choice.display?.trim().toLowerCase();
  if (display) return byDisplay.get(display);

  return undefined;
};

// Fills the budget with the entries the letters already like, then strides
// through the rest so an unrelated-but-relevant entry — the whole reason this
// rung exists — still reaches the model on a set too large to send whole.
export const sampleForShortlist = (
  entries: ValueSetEntry[],
  query: string,
  budget: number,
): ValueSetEntry[] => {
  if (entries.length <= budget) return entries;

  const chosen = new Set<ValueSetEntry>(
    rankValueSetCandidates(entries, query, budget).map((candidate) => candidate.entry),
  );
  if (chosen.size >= budget) return [...chosen].slice(0, budget);

  const stride = Math.max(1, Math.ceil(entries.length / (budget - chosen.size)));
  for (let index = 0; index < entries.length && chosen.size < budget; index += stride) {
    chosen.add(entries[index]!);
  }
  // The stride lands on entries already chosen, so a set can still come up short.
  for (let index = 0; index < entries.length && chosen.size < budget; index += 1) {
    chosen.add(entries[index]!);
  }

  return [...chosen];
};
