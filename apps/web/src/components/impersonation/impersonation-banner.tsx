"use client";

import { useEffect, useState } from "react";
import { Eye } from "lucide-react";
import { trpc } from "@/trpc/client";

// Matches the site banner's deferral: this query runs at the root of every page,
// so rendering its result during hydration would mismatch the server's HTML.
function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}

export function ImpersonationBanner() {
  const hydrated = useHydrated();
  const currentQuery = trpc.impersonation.current.useQuery(undefined, {
    refetchOnWindowFocus: true,
  });
  const utils = trpc.useUtils();

  const stopMutation = trpc.impersonation.stop.useMutation({
    // A full load for the same reason starting one is: the server must re-render
    // as the admin rather than replay the simulated tree.
    onSettled: () => {
      window.location.href = "/chats";
    },
  });
  const extendMutation = trpc.impersonation.extend.useMutation({
    onSuccess: () => utils.impersonation.current.invalidate(),
  });

  const current = currentQuery.data;

  // The countdown is the server's number, re-read once a minute rather than
  // decremented locally, so a sleeping laptop cannot drift out of step.
  useEffect(() => {
    if (!current) return;
    const timer = setInterval(() => {
      void utils.impersonation.current.invalidate();
    }, 60_000);
    return () => clearInterval(timer);
  }, [current, utils]);

  useEffect(() => {
    if (current && current.minutesRemaining <= 0) {
      window.location.href = "/chats";
    }
  }, [current]);

  if (!hydrated || !current) return null;

  const viewingAs = current.targetName ?? current.targetEmail ?? "another user";

  return (
    <div
      role="status"
      data-testid="impersonation-banner"
      className="flex w-full flex-wrap items-center gap-x-[12px] gap-y-[4px] border-b border-[#ddd3f5] bg-[#f3efff] px-[14px] py-[7px] text-[12.5px] text-[#4c3d7a]"
    >
      <Eye aria-hidden="true" className="h-[14px] w-[14px] shrink-0" />
      <span className="min-w-0">
        Viewing as <strong className="font-semibold">{viewingAs}</strong>
        {current.targetEmail && current.targetName ? ` (${current.targetEmail})` : ""}
      </span>

      <span className="ml-auto flex items-center gap-[10px]">
        <span data-testid="impersonation-minutes" className="tabular-nums">
          {current.minutesRemaining} min left
        </span>
        <button
          type="button"
          onClick={() => extendMutation.mutate()}
          disabled={extendMutation.isPending}
          className="rounded-[6px] border border-[#c9b8f0] px-[8px] py-[2px] font-medium transition-colors hover:bg-[#e7dffb] disabled:opacity-60"
        >
          {extendMutation.isPending ? "Extending…" : "Extend"}
        </button>
        <button
          type="button"
          onClick={() => stopMutation.mutate()}
          disabled={stopMutation.isPending}
          className="rounded-[6px] bg-[#5b4b8a] px-[9px] py-[2px] font-medium text-white transition-colors hover:bg-[#4c3d7a] disabled:opacity-60"
        >
          {stopMutation.isPending ? "Returning…" : "Return to your account"}
        </button>
      </span>
    </div>
  );
}
