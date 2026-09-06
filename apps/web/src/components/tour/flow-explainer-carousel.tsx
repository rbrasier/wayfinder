"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { ExplainerAnimation } from "./explainer-animations";
import {
  EXPLAINER_CARDS,
  isLastCard,
  nextCardIndex,
  previousCardIndex,
} from "./flow-explainer-cards";

interface FlowExplainerCarouselProps {
  open: boolean;
  // True when the canvas already has steps: the closing CTA then returns to the
  // canvas rather than pointing at a first-step button that is not there.
  hasSteps: boolean;
  onClose: () => void;
  onFinish: () => void;
}

// The six-card explainer shown over the configure canvas (ADR-056). Arrows
// either side, position dots beneath, arrow keys, and a last card whose call
// to action hands off to "+ Create your first step" rather than just closing.
export function FlowExplainerCarousel({ open, hasSteps, onClose, onFinish }: FlowExplainerCarouselProps) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  const card = EXPLAINER_CARDS[index] ?? EXPLAINER_CARDS[0];
  if (!card) return null;
  const last = isLastCard(index);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight") setIndex(nextCardIndex);
    if (event.key === "ArrowLeft") setIndex(previousCardIndex);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPortal>
        <DialogOverlay className="bg-[rgba(20,18,15,0.5)] backdrop-blur-sm" />
        <DialogPrimitive.Content
          data-testid="flow-explainer"
          onKeyDown={onKeyDown}
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 focus:outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
        >
          <ArrowButton
            direction="previous"
            disabled={index === 0}
            onClick={() => setIndex(previousCardIndex)}
          />
          <ArrowButton
            direction="next"
            disabled={last}
            onClick={() => setIndex(nextCardIndex)}
          />

          <div className="overflow-hidden rounded-[18px] bg-white shadow-[0_4px_24px_rgba(0,0,0,.13),0_20px_60px_rgba(0,0,0,.10)]">
            <div className="flex items-center justify-between px-[22px] pb-3 pt-4">
              <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[#666055]">
                How flows work · {index + 1} of {EXPLAINER_CARDS.length}
              </span>
              <DialogPrimitive.Close className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-[#f5f3ee] text-[#5c574c] transition-colors hover:bg-[#ebe8e0]">
                <X className="h-3.5 w-3.5" />
                <span className="sr-only">Close</span>
              </DialogPrimitive.Close>
            </div>

            <div className="px-[22px]">
              {/* Keyed by card so each illustration starts its loop from the top. */}
              <div key={card.id}>
                <ExplainerAnimation cardId={card.id} />
              </div>
            </div>

            <div className="px-[22px] pb-4 pt-4" aria-live="polite">
              <DialogPrimitive.Title className="text-[17px] font-bold tracking-[-0.3px] text-[#1c1b19]">
                {card.title}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1.5 min-h-[44px] text-[13.5px] leading-[1.55] text-[#5c574c]">
                {card.body}
              </DialogPrimitive.Description>
            </div>

            <div className="flex items-center justify-center gap-2 pb-4" role="tablist" aria-label="Cards">
              {EXPLAINER_CARDS.map((dot, dotIndex) => (
                <button
                  key={dot.id}
                  type="button"
                  role="tab"
                  aria-selected={dotIndex === index}
                  aria-label={`Card ${dotIndex + 1}: ${dot.title}`}
                  onClick={() => setIndex(dotIndex)}
                  className={cn(
                    "h-2 rounded-full transition-all duration-300",
                    dotIndex === index ? "w-5 bg-[#2f56d3]" : "w-2 bg-[#ddd8d0] hover:bg-[#b9b4ab]",
                  )}
                />
              ))}
            </div>

            <div className="flex items-center justify-between border-t border-[#e7e3db] px-[22px] py-[14px]">
              <Button variant="ghost" onClick={onClose}>
                {last ? "Close" : "Skip for now"}
              </Button>
              {last ? (
                <Button onClick={onFinish} data-testid="flow-explainer-finish">
                  {hasSteps ? "Back to the canvas" : "Add my first step →"}
                </Button>
              ) : (
                <Button onClick={() => setIndex(nextCardIndex)}>Next →</Button>
              )}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </DialogPrimitive.Root>
  );
}

function ArrowButton({
  direction,
  disabled,
  onClick,
}: {
  direction: "previous" | "next";
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = direction === "previous" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      aria-label={direction === "previous" ? "Previous card" : "Next card"}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "absolute top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-[#e7e3db] bg-white text-[#1c1b19] shadow-md transition-opacity hover:bg-[#f5f3ee] disabled:opacity-30 disabled:hover:bg-white",
        direction === "previous" ? "left-2 lg:-left-14" : "right-2 lg:-right-14",
      )}
    >
      <Icon size={18} />
    </button>
  );
}
