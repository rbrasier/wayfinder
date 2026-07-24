import { cn } from "@/lib/utils";

// The app's one processing spinner. Chat document generation and the extraction
// run screen render the identical icon, so "something is working" reads the same
// everywhere. Colour is inherited from the surrounding text.
export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn("h-3 w-3 shrink-0 animate-spin", className)}
      viewBox="0 0 24 24"
      fill="none"
      role="status"
      aria-label="Processing"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
