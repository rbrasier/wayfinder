"use client";

import { useEffect, useRef, useState } from "react";

export interface FlowSelectorFlow {
  flowId: string;
  flowName: string;
  sessionCount: number;
}

const FLOW_CARD_THRESHOLD = 5;

// Shared flow picker used by the Flow Usage and Flow Insights reports: shows up
// to five flow cards, then a search box once there are more flows than fit.
export function FlowSelector({
  flows,
  activeFlowId,
  onSelect,
}: {
  flows: FlowSelectorFlow[];
  activeFlowId: string | undefined;
  onSelect: (flowId: string) => void;
}) {
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showSearch) return;

    const handleMouseDown = (event: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setShowSearch(false);
        setSearchQuery("");
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [showSearch]);

  const hasOverflow = flows.length > FLOW_CARD_THRESHOLD;
  const visibleFlows = hasOverflow ? flows.slice(0, FLOW_CARD_THRESHOLD) : flows;

  return (
    <div className="flex flex-wrap gap-2">
      {visibleFlows.map((flow) => {
        const selected = flow.flowId === activeFlowId;
        return (
          <button
            key={flow.flowId}
            type="button"
            onClick={() => onSelect(flow.flowId)}
            className={`rounded-[9px] border px-3 py-2 text-left transition-colors ${
              selected
                ? "border-[#3a5fd9] bg-[#eef2fd]"
                : "border-[#dedad2] bg-white hover:bg-[#f7f6f3]"
            }`}
          >
            <span className="block text-[13px] font-medium text-[#1a1814]">{flow.flowName}</span>
            <span className="block text-[12px] text-[#918d87]">
              {flow.sessionCount} session{flow.sessionCount === 1 ? "" : "s"}
            </span>
          </button>
        );
      })}

      {hasOverflow &&
        (showSearch ? (
          <FlowSearchInput
            flows={flows}
            searchQuery={searchQuery}
            containerRef={searchContainerRef}
            onQueryChange={setSearchQuery}
            onSelect={(flowId) => {
              onSelect(flowId);
              setShowSearch(false);
              setSearchQuery("");
            }}
            onDismiss={() => {
              setShowSearch(false);
              setSearchQuery("");
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setShowSearch(true)}
            className="rounded-[9px] border border-[#dedad2] bg-white px-3 py-2 text-left transition-colors hover:bg-[#f7f6f3]"
          >
            <span className="block text-[13px] font-medium text-[#918d87]">Search for more</span>
          </button>
        ))}
    </div>
  );
}

interface FlowSearchInputProps {
  flows: FlowSelectorFlow[];
  searchQuery: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onQueryChange: (query: string) => void;
  onSelect: (flowId: string) => void;
  onDismiss: () => void;
}

function FlowSearchInput({
  flows,
  searchQuery,
  containerRef,
  onQueryChange,
  onSelect,
  onDismiss,
}: FlowSearchInputProps) {
  const filtered = flows.filter((flow) =>
    flow.flowName.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <div ref={containerRef} className="relative">
      <input
        autoFocus
        type="text"
        value={searchQuery}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onDismiss();
        }}
        placeholder="Search flows…"
        className="rounded-[9px] border border-[#3a5fd9] bg-white px-3 py-2 text-[13px] text-[#1a1814] outline-none placeholder:text-[#c4bfb8]"
      />
      {filtered.length > 0 && (
        <ul className="absolute left-0 top-full z-10 mt-1 w-[240px] overflow-hidden rounded-[9px] border border-[#dedad2] bg-white shadow-md">
          {filtered.map((flow) => (
            <li key={flow.flowId}>
              <button
                type="button"
                data-testid="flow-search-option"
                onMouseDown={(event) => {
                  // Prevent input blur before the click registers
                  event.preventDefault();
                  onSelect(flow.flowId);
                }}
                className="w-full px-3 py-2 text-left hover:bg-[#f7f6f3]"
              >
                <span className="block text-[13px] font-medium text-[#1a1814]">{flow.flowName}</span>
                <span className="block text-[12px] text-[#918d87]">
                  {flow.sessionCount} session{flow.sessionCount === 1 ? "" : "s"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
