// Subtle skeleton shown the instant a user-area navigation starts, so the
// previous page is never held on screen while the destination's server work runs.
const rows = ["a", "b", "c", "d", "e"];

export default function Loading() {
  return (
    <div className="flex h-full flex-col gap-[14px] p-[28px]" aria-hidden>
      <div className="h-[26px] w-[200px] animate-pulse rounded-[6px] bg-[#e9e7e1]" />
      <div className="h-[14px] w-[300px] animate-pulse rounded-[4px] bg-[#edeae3]" />
      <div className="mt-[6px] flex flex-col gap-[10px]">
        {rows.map((row) => (
          <div key={row} className="h-[58px] animate-pulse rounded-[10px] bg-[#edeae3]" />
        ))}
      </div>
    </div>
  );
}
