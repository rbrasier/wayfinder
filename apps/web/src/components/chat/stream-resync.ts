// Whether the chat should replace its streamed (useChat) list with the persisted
// transcript. The feed appends the streamed entries past the persisted count, so
// the two lists must line up one-for-one between turns or that tail repeats
// messages the transcript already rendered.
//
// Staleness is judged by fetch time, not by comparing lengths. A length guard
// ("skip while the stream is longer") never recovers once the stream holds an
// entry the server never saved — a resend the server deduplicates, or a failed
// send — and the latest reply then renders twice on every turn (#308).

export interface StreamResyncInput {
  isTurnInFlight: boolean;
  // Kept after an error so Retry, which resends the last streamed user message,
  // still finds the failed one.
  lastTurnErrored: boolean;
  // When the last turn was sent or settled; only data fetched after it can be
  // trusted to include what that turn persisted.
  lastTurnBoundaryAt: number;
  persistedFetchedAt: number;
  persistedIds: readonly string[];
  streamedIds: readonly string[];
}

export const shouldResyncStreamedMessages = (input: StreamResyncInput): boolean => {
  if (input.isTurnInFlight) return false;
  if (input.lastTurnErrored) return false;
  if (input.persistedFetchedAt <= input.lastTurnBoundaryAt) return false;

  const inSync =
    input.persistedIds.length === input.streamedIds.length &&
    input.persistedIds.every((id, index) => id === input.streamedIds[index]);
  return !inSync;
};
