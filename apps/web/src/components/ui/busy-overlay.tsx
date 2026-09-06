import { Spinner } from "./spinner";

// A blocking, page-covering "working on it" state for an action that calls the
// server and then navigates. Neither existing signal covers that wait: the
// button's own disabled state is easy to miss, and the top navigation bar only
// starts on anchor clicks, so a router.push from a button shows nothing at all.
export function BusyOverlay({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      // Above the dialog it covers (z-50) and the navigation bar (z-100).
      className="fixed inset-0 z-[200] flex items-center justify-center bg-[rgba(20,18,15,0.45)] backdrop-blur-sm"
    >
      <div className="flex items-center gap-2.5 rounded-[12px] bg-white px-5 py-3.5 shadow-[0_4px_24px_rgba(0,0,0,.13),0_20px_60px_rgba(0,0,0,.10)]">
        <Spinner className="h-4 w-4 text-[#2f56d3]" />
        <span className="text-[13px] font-medium text-[#1c1b19]">{label}</span>
      </div>
    </div>
  );
}
