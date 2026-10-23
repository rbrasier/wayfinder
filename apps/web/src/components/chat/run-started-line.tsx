"use client";

import { Zap } from "lucide-react";
import type { RunStartedSource } from "@rbrasier/domain";

const MAX_VALUE_LENGTH = 80;

const shorten = (value: string): string =>
  value.length > MAX_VALUE_LENGTH ? `${value.slice(0, MAX_VALUE_LENGTH - 1)}…` : value;

// The quiet line an unattended run's chat opens with (ADR-065 §2): what started
// it, and the inputs it was given — the same values the run carries as
// gathered insights.
export function RunStartedLine({
  source,
  inputs,
}: {
  source: RunStartedSource;
  inputs: { key: string; value: string }[];
}) {
  return (
    <div data-testid="run-started-line" className="my-2 flex flex-col items-center gap-0.5 text-center">
      <p className="flex items-center gap-1.5 text-[12px] font-medium text-[#666055]">
        <Zap size={12} aria-hidden />
        {source.origin === "watch" && source.sourceName
          ? `Started by Event Watch “${source.sourceName}”`
          : "Started by a webhook"}
      </p>
      {inputs.length > 0 && (
        <p className="max-w-xl text-[11.5px] text-[#736d5f]">
          {inputs.map((input) => `${input.key}: ${shorten(input.value)}`).join(" · ")}
        </p>
      )}
    </div>
  );
}
