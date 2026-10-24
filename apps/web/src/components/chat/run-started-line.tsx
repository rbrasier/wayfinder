"use client";

import { Zap } from "lucide-react";
import { RUN_STARTED_SOURCE_TAG, type RunStartedSource } from "@rbrasier/domain";

const MAX_VALUE_LENGTH = 80;
// The rest stay in the run's insights; the line only has to say what it was.
const MAX_SHOWN = 8;

const shorten = (value: string): string =>
  value.length > MAX_VALUE_LENGTH ? `${value.slice(0, MAX_VALUE_LENGTH - 1)}…` : value;

// The quiet line an unattended run's chat opens with (ADR-065 §2): what started
// it, and the first few of the values it was given — the same values the run
// carries as gathered insights, here without the source tag the line already says.
export function RunStartedLine({
  source,
  inputs,
}: {
  source: RunStartedSource;
  inputs: { key: string; value: string }[];
}) {
  const prefix = `${RUN_STARTED_SOURCE_TAG[source.origin]} · `;
  const shown = inputs
    .slice(0, MAX_SHOWN)
    .map(
      (input) =>
        `${input.key.startsWith(prefix) ? input.key.slice(prefix.length) : input.key}: ${shorten(input.value)}`,
    );
  const more = inputs.length - shown.length;
  return (
    <div
      data-testid="run-started-line"
      className="my-2 flex flex-col items-center gap-0.5 text-center"
    >
      <p className="flex items-center gap-1.5 text-[12px] font-medium text-[#666055]">
        <Zap size={12} aria-hidden />
        {source.origin === "watch" && source.sourceName
          ? `Started by Event Watch “${source.sourceName}”`
          : "Started by a webhook"}
      </p>
      {inputs.length > 0 && (
        <p className="max-w-xl text-[11.5px] text-[#736d5f]">
          {shown.join(" · ")}
          {more > 0 && ` · +${more} more`}
        </p>
      )}
    </div>
  );
}
